//! The `tjs` child process and the framing on top of it.
//!
//! A plugin runs in a separate process, not in this one. That is not an
//! optimisation: a plugin that calls `tjs.exit()`, or a bug in the C engine
//! underneath it, has to be able to die without taking the reader with it — and
//! a separate process is also the only way to put a real deadline on a plugin
//! that has stopped listening, since a deadline the plugin could decline to
//! respect is not one.
//!
//! Everything here is blocking. A call writes a request, waits for the answer
//! and returns, so callers never hold a future and the UI thread never has to
//! poll one.

use std::ffi::OsStr;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::plugin::HostRequest;

/// How long a single call may take before the runtime is killed.
///
/// A plugin reads someone else's site over someone else's connection, so there
/// is no honest bound on how long one may legitimately take — but there is a
/// bound on how long the reader will wait. Thirty seconds is long enough for a
/// slow site on a slow connection and short enough that a plugin stuck in
/// `while (true)` costs the user half a minute rather than a frozen window.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Environment variable pointing at a `tjs` to use instead of the vendored one.
///
/// For working on the runtime itself: point it at a local txiki.js build and
/// the vendored copy is ignored.
pub const TJS_ENV: &str = "ROME_TJS";

/// Environment variable that overrides the harness path.
pub const HARNESS_ENV: &str = "ROME_HARNESS";

/// Where the harness lives, relative to the crate root.
const HARNESS_FILE: &str = "runtime/harness.js";

/// Where vendored runtimes live, relative to the crate root.
const VENDOR_DIR: &str = "vendor/txiki";

/// The binary's name inside each per-triple directory.
const TJS_FILE: &str = "tjs";

/// The command that produces a vendored runtime, quoted when one is missing.
const BUILD_COMMAND: &str =
    "git clone --recursive --shallow-submodules https://github.com/saghul/txiki.js && make -j8";

/// Ceiling on the runtime's JavaScript heap, in bytes.
///
/// The point is to bound a runaway plugin, not to defend against a hostile one:
/// the trust model is that the user audits what they install, so the job here
/// is to make a plugin that allocates without bound fail at a limit the user
/// can read in an error message, instead of taking the machine's memory down
/// with it. 128 MiB is far more than parsing a feed needs and far less than a
/// machine has.
const MEMORY_LIMIT_BYTES: u64 = 128 * 1024 * 1024;

/// Ceiling on the JavaScript stack, in bytes.
///
/// txiki.js defaults to 1 MiB or 2 MiB depending on the platform; this states
/// the larger of the two so the ceiling does not depend on which platform the
/// app was built for.
const STACK_SIZE_BYTES: u64 = 2 * 1024 * 1024;

/// How much of the runtime's stderr is kept for error messages.
const STDERR_LIMIT_BYTES: usize = 8 * 1024;

/// A running `tjs` child, and the framing that talks to it.
///
/// One child per plugin. The child is the isolation boundary, so sharing one
/// between plugins would let them see each other's globals — and would let one
/// plugin's `tjs.exit()` end every other plugin's run.
pub struct Sidecar {
    child: Child,
    /// The child's stdin.
    ///
    /// Held open for the process's whole life: closing it is how the child
    /// learns there is nothing more coming, and it cannot be reopened.
    stdin: ChildStdin,
    /// Lines from the child's stdout, in the order they arrived.
    ///
    /// A thread does the reading rather than this struct, because a blocking
    /// read on a pipe cannot be given a deadline and the deadline is the whole
    /// point — a plugin that never answers must not be able to stop the caller
    /// from giving up on it. The thread reads and buffers; [`Sidecar::call`]
    /// waits on the channel with a timeout and kills the child when it expires.
    lines: Receiver<io::Result<String>>,
    stdout_thread: Option<JoinHandle<()>>,
    /// Everything the child has written to stderr, capped at
    /// [`STDERR_LIMIT_BYTES`].
    ///
    /// Read on a second thread for the same reason as stdout: a child that
    /// fills its stderr pipe blocks on the write, so the pipe has to keep
    /// draining even when nobody is looking at it. A plugin that throws while
    /// loading explains itself here and nowhere else, which is why the tail of
    /// it is worth keeping.
    stderr: Arc<Mutex<String>>,
    stderr_thread: Option<JoinHandle<()>>,
    /// Ids for host to plugin calls. Monotonic and never reused, so a late
    /// answer to an abandoned call cannot be mistaken for the answer to a new
    /// one.
    next_id: u64,
    timeout: Duration,
    /// Set once the child has been killed and reaped, after which nothing more
    /// can be sent to it.
    exited: bool,
}

impl Sidecar {
    /// Launch the plugin runtime on `harness_path`.
    pub fn spawn(harness_path: &Path) -> io::Result<Self> {
        Self::spawn_with_args(harness_path, std::iter::empty::<&OsStr>())
    }

    /// Launch the runtime on `harness_path`, passing `extra_args` through to it.
    ///
    /// The harness sees these in `tjs.args` after its own path, which is how one
    /// harness file serves every plugin: the plugin's path goes here rather than
    /// being baked into the harness source.
    pub fn spawn_with_args<I, S>(harness_path: &Path, extra_args: I) -> io::Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let binary = runtime_path()?;

        let mut command = Command::new(&binary);

        // Resource flags come before the subcommand: `run` stops option parsing
        // at the first non-option argument, so anything after it is passed to
        // the script instead of to the engine.
        command
            .arg("--memory-limit")
            .arg(MEMORY_LIMIT_BYTES.to_string())
            .arg("--stack-size")
            .arg(STACK_SIZE_BYTES.to_string())
            // `run` is required. A bare `tjs <file>` prints usage and exits 1.
            .arg("run")
            .arg(harness_path)
            .args(extra_args);

        Self::spawn_command(command)
    }

    /// Take over an already-built command.
    ///
    /// The pipe plumbing is the same whatever is on the other end, so this is
    /// also the seam the tests drive a fake runtime through — the framing is
    /// what they are testing, and a shell writes a byte stream over a pipe
    /// exactly as well as a JavaScript engine does.
    fn spawn_command(mut command: Command) -> io::Result<Self> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // `expect` rather than `?`: the pipes were just asked for, so a missing
        // one is a bug here, not a condition the caller can do anything about.
        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");
        let stderr = child.stderr.take().expect("stderr was piped");

        let (sender, lines) = mpsc::channel();
        let stdout_thread = std::thread::spawn(move || read_stdout(stdout, sender));

        let collected = Arc::new(Mutex::new(String::new()));
        let stderr_thread = std::thread::spawn({
            let collected = Arc::clone(&collected);
            move || read_stderr(stderr, &collected)
        });

        Ok(Self {
            child,
            stdin,
            lines,
            stdout_thread: Some(stdout_thread),
            stderr: collected,
            stderr_thread: Some(stderr_thread),
            next_id: 1,
            timeout: DEFAULT_TIMEOUT,
            exited: false,
        })
    }

    /// Make one host to plugin call and return its result.
    ///
    /// `handler` answers the requests the plugin sends back while it works on
    /// this one. Dispatching them here rather than after the call returns is not
    /// a convenience: the plugin is blocked on that reply, so a loop that read
    /// past the request and kept waiting for the response would wait forever for
    /// an answer the plugin cannot send until it gets one.
    ///
    /// A plugin that reports an error, that writes something that is not
    /// protocol, or that dies, is an `Err` — with whatever it last said on
    /// stderr attached, since that is where a plugin explains itself.
    pub fn call(
        &mut self,
        method: &str,
        params: Value,
        mut handler: impl FnMut(HostRequest) -> Result<Value, String>,
    ) -> io::Result<Value> {
        if self.exited {
            return Err(self.failed(
                io::ErrorKind::BrokenPipe,
                format!("the plugin runtime is gone; `{method}` cannot be sent"),
            ));
        }

        let id = self.next_id;
        // Not reachable in practice; wrapping rather than panicking keeps a
        // counter overflow from being a crash in a debug build.
        self.next_id = self.next_id.wrapping_add(1);

        self.send(&json!({ "id": id, "method": method, "params": params }))?;

        let mut deadline = Instant::now() + self.timeout;

        loop {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return Err(self.timed_out(method, id));
            };
            if remaining.is_zero() {
                return Err(self.timed_out(method, id));
            }

            // Bound to a local so the borrow of `self.lines` ends here; the
            // arms below need `&mut self`.
            let received = self.lines.recv_timeout(remaining);

            match received {
                Ok(Ok(line)) => {
                    if let Some(result) = self.dispatch(&line, id, method, &mut handler, &mut deadline)?
                    {
                        return Ok(result);
                    }
                }
                Ok(Err(error)) => {
                    let kind = error.kind();
                    return Err(self.failed(
                        kind,
                        format!("reading the plugin's answer to `{method}` failed: {error}"),
                    ));
                }
                Err(RecvTimeoutError::Timeout) => return Err(self.timed_out(method, id)),
                Err(RecvTimeoutError::Disconnected) => {
                    self.reap();
                    return Err(self.failed(
                        io::ErrorKind::UnexpectedEof,
                        format!("the plugin runtime exited without answering `{method}`"),
                    ));
                }
            }
        }
    }

    /// How long a call may take before the runtime is killed.
    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    /// Change the deadline for calls made from now on.
    pub fn set_timeout(&mut self, timeout: Duration) {
        self.timeout = timeout;
    }

    /// Route one line from the child.
    ///
    /// Either the child is asking the host for something, or it is answering the
    /// call in flight. `Ok(Some(result))` means it was the answer.
    fn dispatch(
        &mut self,
        line: &str,
        id: u64,
        method: &str,
        handler: &mut impl FnMut(HostRequest) -> Result<Value, String>,
        deadline: &mut Instant,
    ) -> io::Result<Option<Value>> {
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(error) => {
                return Err(self.failed(
                    io::ErrorKind::InvalidData,
                    format!(
                        "the plugin wrote a line that is not JSON ({error}): {}",
                        line.trim_end()
                    ),
                ));
            }
        };

        // Requests are checked first, and `method` is what identifies them: the
        // plugin allocates its own ids, so one of its requests can carry the
        // same number as the call it is interrupting. Treating an unknown id as
        // "not mine, skip it" is exactly the deadlock this avoids.
        if let Some(request) = HostRequest::parse(&value) {
            let reply_id = request.id;
            // Whether a person is being waited on has to be read before the
            // request is moved into the handler.
            let waits_for_user = request.waits_for_user();
            let asked_at = Instant::now();
            // The plugin is blocked on this reply, so a host method that cannot
            // do its job still has to answer — with an error, which the harness
            // turns into a rejected promise. Returning a placeholder result
            // instead would resolve the plugin's `await` with nonsense and turn
            // a clear failure into a confusing one.
            let reply = match handler(request) {
                Ok(result) => json!({ "id": reply_id, "result": result }),
                Err(message) => json!({ "id": reply_id, "error": { "message": message } }),
            };

            // A dialog is not a hang. Charging the user's thinking time to the
            // plugin's deadline killed the runtime on anyone who took more than
            // half a minute to type an API key — and a login window would make
            // that certain rather than possible. The download deadline applies
            // to the plugin's own work, so the time spent here is handed back.
            if waits_for_user {
                *deadline += asked_at.elapsed();
            }

            self.send(&reply)?;
            return Ok(None);
        }

        if value.get("id").and_then(Value::as_u64) != Some(id) {
            // Not a request and not the answer being waited for. Calls are
            // serialised, so a well-behaved plugin never produces this, but it
            // can be the late answer to a call that timed out — worth ignoring
            // rather than failing the call over.
            return Ok(None);
        }

        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("the plugin gave no message");
            return Err(self.failed(io::ErrorKind::Other, format!("`{method}` failed: {message}")));
        }

        // A response with neither field is malformed, but an empty result is
        // the closest reading and the protocol has no third shape.
        Ok(Some(value.get("result").cloned().unwrap_or(Value::Null)))
    }

    /// Write one protocol object to the child.
    fn send(&mut self, value: &Value) -> io::Result<()> {
        let line = match serde_json::to_string(value) {
            Ok(line) => line,
            Err(error) => {
                return Err(self.failed(
                    io::ErrorKind::InvalidData,
                    format!("could not encode a protocol message: {error}"),
                ));
            }
        };

        if let Err(error) = write_line(&mut self.stdin, &line) {
            return Err(self.failed(
                io::ErrorKind::BrokenPipe,
                format!("could not write to the plugin runtime: {error}"),
            ));
        }

        Ok(())
    }

    /// Kill the child and collect the threads that were reading from it.
    ///
    /// Idempotent, because both a failed call and `Drop` end up here.
    fn reap(&mut self) {
        if self.exited {
            return;
        }
        self.exited = true;

        // Killing before waiting, not instead of it: the wait reaps the process
        // so it does not linger as a zombie, and the kill is what makes the wait
        // return rather than block on a child that has decided not to exit.
        let _ = self.child.kill();
        let _ = self.child.wait();

        // Both readers see EOF once the process is gone, so neither join can
        // block for long. Joining the stderr one is what makes the error
        // messages below complete: everything the child said before dying is in
        // the buffer by the time this returns.
        if let Some(thread) = self.stdout_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.stderr_thread.take() {
            let _ = thread.join();
        }
    }

    /// An error carrying whatever the child last said on stderr.
    ///
    /// The child explains itself there — a plugin that throws while loading
    /// prints the stack there and nowhere else — so dropping it leaves the user
    /// with "the plugin failed" and no way to find out why.
    fn failed(&self, kind: io::ErrorKind, message: impl std::fmt::Display) -> io::Error {
        let stderr = self.stderr_tail();

        let message = if stderr.is_empty() {
            message.to_string()
        } else {
            format!("{message}\n--- plugin stderr ---\n{stderr}")
        };

        io::Error::new(kind, message)
    }

    /// The child's stderr so far, trimmed.
    fn stderr_tail(&self) -> String {
        self.stderr
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .trim()
            .to_owned()
    }

    /// Give up on `method` and kill the runtime.
    fn timed_out(&mut self, method: &str, id: u64) -> io::Error {
        self.reap();

        self.failed(
            io::ErrorKind::TimedOut,
            format!(
                "`{method}` (id {id}) did not answer within {:?}; the plugin runtime was killed",
                self.timeout
            ),
        )
    }
}

impl Drop for Sidecar {
    /// Kill the child rather than asking it to stop.
    ///
    /// A graceful stop is `deactivate`, which the caller sends explicitly. By
    /// the time this runs the caller has given up on the child, so waiting for
    /// it to shut down politely means waiting for a plugin that has already
    /// shown it will not answer.
    fn drop(&mut self) {
        self.reap();
    }
}

/// The `tjs` binary to run plugins with.
///
/// `ROME_TJS` wins, for working on the runtime itself. Otherwise it is the
/// vendored build for this platform: committed rather than downloaded so a
/// build needs no network, and so the engine a plugin was tested against is the
/// one it runs on. See `vendor/txiki/README.md`.
pub fn runtime_path() -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os(TJS_ENV) {
        return Ok(PathBuf::from(path));
    }

    vendored_runtime()
}

/// The harness the runtime loads a plugin into.
///
/// Part of the application rather than of the vendored runtime: it is the other
/// half of the protocol described in [`crate::plugin`], so it ships with the
/// host that speaks it and is versioned with it. `ROME_HARNESS` overrides it,
/// the same way `ROME_TJS` overrides the runtime.
pub fn harness_path() -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os(HARNESS_ENV) {
        return Ok(PathBuf::from(path));
    }

    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(HARNESS_FILE);

    if path.is_file() {
        return Ok(path);
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("the plugin harness is missing at {}", path.display()),
    ))
}

/// Find the vendored runtime for the platform this binary was built for.
///
/// The directories are named after target triples, which cargo does not expose
/// to the crate it is compiling — it sets those variables for build scripts
/// only. So this matches on the two components that are available (the
/// architecture, and the operating system under its triple spelling) rather
/// than keeping a table of triples in sync by hand.
fn vendored_runtime() -> io::Result<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join(VENDOR_DIR);

    let mut found: Vec<(String, PathBuf)> = std::fs::read_dir(&root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| (entry.file_name().to_string_lossy().into_owned(), entry.path().join(TJS_FILE)))
        .filter(|(_, binary)| binary.is_file())
        .collect();
    found.sort();

    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };

    found
        .iter()
        .find(|(triple, _)| {
            triple.split('-').next() == Some(std::env::consts::ARCH) && triple.contains(os)
        })
        // A single vendored runtime is unambiguous even if its directory is
        // named unexpectedly, so it is used rather than refused.
        .or_else(|| if found.len() == 1 { found.first() } else { None })
        .map(|(_, binary)| binary.clone())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!(
                    "no plugin runtime in {}. Vendored builds live at {VENDOR_DIR}/<target-triple>/{TJS_FILE}; build one with:\n    {BUILD_COMMAND}",
                    root.display(),
                ),
            )
        })
}

/// Write one line and push it out of the pipe.
///
/// The flush is not optional: the child is blocked on this line, and a pipe is
/// a buffer, so a request left sitting in one is a request the plugin never
/// sees.
fn write_line(stdin: &mut ChildStdin, line: &str) -> io::Result<()> {
    stdin.write_all(line.as_bytes())?;
    stdin.write_all(b"\n")?;
    stdin.flush()
}

/// Feed the child's stdout into `sender`, one line at a time.
fn read_stdout(stdout: ChildStdout, sender: Sender<io::Result<String>>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();

        match reader.read_line(&mut line) {
            // EOF: the child is gone, or has closed its stdout. Dropping the
            // sender is what tells `call` that no more lines are coming — and
            // because the channel is a queue, anything already sent arrives
            // before that.
            Ok(0) => return,
            Ok(_) => {
                // Unbounded, so this never blocks the reader.
                let _ = sender.send(Ok(std::mem::take(&mut line)));
            }
            Err(error) => {
                let _ = sender.send(Err(error));
                return;
            }
        }
    }
}

/// Keep the child's stderr drained and remember the tail of it.
///
/// Drained because a full pipe blocks the child mid-write, and only the tail
/// because a plugin that logs in a loop must not be able to grow the host's
/// memory. The tail is the end worth keeping: that is where the error is.
fn read_stderr(stderr: ChildStderr, collected: &Arc<Mutex<String>>) {
    let mut reader = BufReader::new(stderr);
    let mut line = String::new();

    loop {
        line.clear();

        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                let mut buffer = collected
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());

                buffer.push_str(&line);

                if buffer.len() > STDERR_LIMIT_BYTES {
                    // Cut on a char boundary: stderr is UTF-8 in practice, but
                    // nothing enforces it and slicing mid-character panics.
                    let over = buffer.len() - STDERR_LIMIT_BYTES;
                    let cut = (over..buffer.len())
                        .find(|index| buffer.is_char_boundary(*index))
                        .unwrap_or(buffer.len());
                    buffer.drain(..cut);
                }
            }
        }
    }
}

/// Framing, timeouts and the host-bound-request dispatch.
///
/// The runtime is not needed to test any of that, and requiring it would tie
/// these tests to a vendored binary being present and built. `/bin/sh` stands in
/// for it: what is under test is a byte stream over a pipe, and a shell writes
/// one exactly as well as a JavaScript engine does.
#[cfg(unix)]
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Distinguishes scratch directories, so tests running in parallel — or two
    /// `cargo test` runs at once — do not collide.
    static NEXT_SCRATCH: AtomicUsize = AtomicUsize::new(0);

    /// A directory of this test's own, under the system temporary directory.
    fn scratch_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rome-sidecar-{}-{}",
            std::process::id(),
            NEXT_SCRATCH.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir_all(&dir).expect("could not create the scratch directory");
        dir
    }

    /// A fake runtime that speaks the child's half of the protocol.
    ///
    /// The script is passed to the shell as an argument rather than being made
    /// executable, so it never needs to be chmod'd and its directory never needs
    /// to be the working directory.
    fn fake_runtime(script: &str) -> Command {
        let path = scratch_dir().join("fake-runtime.sh");
        std::fs::write(&path, script).expect("could not write the fake runtime");

        let mut command = Command::new("/bin/sh");
        command.arg(&path);
        command
    }

    /// A call whose answer arrives is a call that returns the answer.
    #[test]
    fn a_call_returns_the_matching_response() {
        let mut sidecar = Sidecar::spawn_command(fake_runtime(
            "read -r request\nprintf '{\"id\":1,\"result\":{\"pong\":true}}\\n'\n",
        ))
        .expect("the fake runtime should start");

        let mut handled = 0;
        let result = sidecar
            .call("describe", json!({}), |_| {
                handled += 1;
                Ok(Value::Null)
            })
            .expect("the call should succeed");

        assert_eq!(result, json!({ "pong": true }));
        assert_eq!(handled, 0, "no host-bound request was sent");
    }

    /// The request that goes out is one line of the protocol, with the id the
    /// response is matched on.
    #[test]
    fn a_request_is_one_line_of_json() {
        let mut sidecar = Sidecar::spawn_command(fake_runtime(
            "read -r request\nprintf '{\"id\":1,\"result\":%s}\\n' \"$request\"\n",
        ))
        .expect("the fake runtime should start");

        let params = json!({ "settings": { "token": "x" }, "params": { "board": "rust" }, "cursor": null });
        let echoed = sidecar
            .call("fetch", params.clone(), |_| Ok(Value::Null))
            .expect("the call should succeed");

        // The script echoes back the exact line it read, so this is the wire
        // form and not a reconstruction of it.
        assert_eq!(echoed, json!({ "id": 1, "method": "fetch", "params": params }));
    }

    /// A plugin that never answers is killed at the deadline rather than
    /// hanging the caller.
    #[test]
    fn a_plugin_that_never_answers_is_killed() {
        let mut sidecar =
            Sidecar::spawn_command(fake_runtime("read -r request\nexec sleep 30\n"))
                .expect("the fake runtime should start");
        sidecar.set_timeout(Duration::from_millis(150));

        let started = Instant::now();
        let error = sidecar
            .call("fetch", json!({}), |_| Ok(Value::Null))
            .expect_err("a plugin that never answers should fail the call");

        assert_eq!(error.kind(), io::ErrorKind::TimedOut, "{error}");
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the call returned at its own deadline, not when the child chose to exit"
        );
        assert!(sidecar.exited, "the runtime was killed on timeout");
    }

    /// Time a person spends answering a dialog is not the plugin hanging.
    ///
    /// The deadline exists to stop a stuck plugin; charging the user's typing
    /// time to it killed the runtime of anyone who took longer than half a
    /// minute to fill in a form. Here the host takes twice the whole deadline
    /// to answer — a stand-in for a person — and the call must still succeed.
    #[test]
    fn a_dialog_outlives_the_deadline() {
        let mut sidecar = Sidecar::spawn_command(fake_runtime(
            r#"read -r request
printf '{"id":7,"method":"ui","params":{"kind":"prompt"}}\n'
read -r reply
printf '{"id":1,"result":%s}\n' "$reply"
"#,
        ))
        .expect("the fake runtime should start");
        sidecar.set_timeout(Duration::from_millis(120));

        let result = sidecar
            .call("fetch", json!({}), |_| {
                // The user is thinking.
                std::thread::sleep(Duration::from_millis(250));
                Ok(Value::String("typed".to_owned()))
            })
            .expect("waiting for a person should not time out the plugin");

        assert_eq!(result, json!({ "id": 7, "result": "typed" }));
    }

    /// The child's requests are dispatched while the host waits, and its reply
    /// is written back — this is the case a loop that skips unknown ids
    /// deadlocks on.
    #[test]
    fn a_request_from_the_plugin_is_dispatched_while_the_host_waits() {
        let mut sidecar = Sidecar::spawn_command(fake_runtime(
            r#"read -r request
printf '{"id":7,"method":"log","params":{"level":"info","message":"hello"}}\n'
read -r reply
printf '{"id":1,"result":%s}\n' "$reply"
"#,
        ))
        .expect("the fake runtime should start");
        // Without this, a regression here hangs the suite for the default
        // timeout instead of failing it.
        sidecar.set_timeout(Duration::from_secs(10));

        let mut seen = Vec::new();
        let result = sidecar
            .call("fetch", json!({}), |request| {
                seen.push(request);
                Ok(Value::Null)
            })
            .expect("the call should succeed");

        assert_eq!(
            seen,
            vec![HostRequest {
                id: 7,
                method: "log".to_string(),
                params: json!({ "level": "info", "message": "hello" }),
            }]
        );

        // The script reports the reply it received as its own result, so this
        // is proof the host wrote one, addressed to the plugin's id — the
        // plugin cannot have answered otherwise, it was blocked on the read.
        assert_eq!(result, json!({ "id": 7, "result": null }));
    }

    /// A host method that cannot do its job answers with an error, so the
    /// plugin's `await` rejects instead of resolving with a placeholder.
    #[test]
    fn a_host_method_that_fails_answers_with_an_error() {
        let mut sidecar = Sidecar::spawn_command(fake_runtime(
            r#"read -r request
printf '{"id":7,"method":"ui","params":{"kind":"confirm"}}\n'
read -r reply
printf '{"id":1,"result":%s}\n' "$reply"
"#,
        ))
        .expect("the fake runtime should start");
        sidecar.set_timeout(Duration::from_secs(10));

        let result = sidecar
            .call("fetch", json!({}), |_| Err("no window to show a dialog in".into()))
            .expect("the call itself still succeeds");

        // The reply the plugin received, reported back as its own result.
        assert_eq!(
            result,
            json!({ "id": 7, "error": { "message": "no window to show a dialog in" } })
        );
    }

    /// A plugin's `error` response is a failed call, not a result.
    #[test]
    fn an_error_response_fails_the_call() {
        let mut sidecar = Sidecar::spawn_command(fake_runtime(
            "read -r request\nprintf '{\"id\":1,\"error\":{\"message\":\"no such source\"}}\\n'\n",
        ))
        .expect("the fake runtime should start");

        let error = sidecar
            .call("fetch", json!({}), |_| Ok(Value::Null))
            .expect_err("an error response should fail the call");

        assert!(
            error.to_string().contains("no such source"),
            "the plugin's message is in the error: {error}"
        );
    }

    /// The smallest harness that is still a harness: read a line, answer it.
    ///
    /// `console.log` is stdout in txiki.js, which is what makes stdout usable as
    /// the protocol channel at all.
    const HARNESS: &str = r#"
const decoder = new TextDecoder();
const reader = tjs.stdin.getReader();
let buffer = '';

while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        console.log(JSON.stringify({
            id: request.id,
            result: { args: tjs.args, echo: request.params },
        }));
    }
}
"#;

    /// The whole chain against the real engine: the vendored binary is found,
    /// the resource flags are accepted, and a request reaches JavaScript and
    /// comes back.
    ///
    /// This is the only test that ties `vendor/` to [`runtime_path`], and the
    /// only one that would catch the flags being placed where `tjs` ignores
    /// them. It is skipped when this platform has no vendored runtime — the
    /// layout is one directory per target triple, so a contributor on a platform
    /// nobody has vendored for yet does not have a broken build — but any other
    /// failure is a failure.
    #[test]
    fn the_real_runtime_round_trips_a_call() {
        if let Err(error) = runtime_path() {
            assert_eq!(
                error.kind(),
                io::ErrorKind::NotFound,
                "the runtime is missing for a reason other than not being vendored: {error}"
            );
            return;
        }

        let harness = scratch_dir().join("harness.js");
        std::fs::write(&harness, HARNESS).expect("could not write the harness");

        let mut sidecar =
            Sidecar::spawn_with_args(&harness, ["/plugins/example.js"]).expect("spawn");
        sidecar.set_timeout(Duration::from_secs(10));

        let result = sidecar
            .call("describe", json!({ "board": "rust" }), |_| Ok(Value::Null))
            .expect("the real runtime should answer");

        assert_eq!(result["echo"], json!({ "board": "rust" }));

        // The harness reads its arguments, so where they land is a contract
        // between this and the harness. Asserting on the end rather than an
        // index is the point: the resource flags sit in front of the harness
        // path, so its position is not fixed, but the plugin is always last.
        let args: Vec<String> = serde_json::from_value(result["args"].clone())
            .expect("tjs.args is an array of strings");
        assert!(
            args.iter().any(|arg| arg.ends_with("harness.js")),
            "the harness is in the arguments: {args:?}"
        );
        assert_eq!(
            args.last().map(String::as_str),
            Some("/plugins/example.js"),
            "the plugin path is passed through as the last argument: {args:?}"
        );
    }

    /// A runtime that dies says why on stderr, and that has to reach the caller.
    #[test]
    fn the_runtime_stderr_reaches_the_error() {
        // The script reads the request before dying, so the failure under test
        // is the death and not a broken pipe from writing to a process that had
        // already exited.
        let mut sidecar = Sidecar::spawn_command(fake_runtime(
            "read -r request\necho 'plugin.js: SyntaxError: unexpected token' >&2\nexit 1\n",
        ))
        .expect("the fake runtime should start");
        sidecar.set_timeout(Duration::from_secs(10));

        let error = sidecar
            .call("describe", json!({}), |_| Ok(Value::Null))
            .expect_err("a runtime that exited should fail the call");

        assert!(
            error.to_string().contains("SyntaxError"),
            "the runtime's stderr is in the error: {error}"
        );
    }
}
