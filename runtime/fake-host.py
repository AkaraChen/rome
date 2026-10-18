#!/usr/bin/env python3
"""A fake Rome host, for exercising runtime/harness.js without the Rust app.

It speaks the frozen protocol over the harness's stdin/stdout exactly like the
real host does: it sends `describe` / `fetch` / `activate` / `deactivate`, and
while it waits for a response it services whatever the plugin asks for
(`http`, `ui`, `storage.*`, `log`).

Usage:
    python3 runtime/fake-host.py [scenario] [plugin.js]

    With no arguments it runs every scenario against its own fixture plugin.
    `scenario` is one of: describe | fetch | paginate | lifecycle | error |
    globals | hostapi | unknown | badmeta | all   (default: all).
    Passing a plugin path runs that file instead of the scenario's fixture.

    TJS=/path/to/tjs  overrides the runtime binary
                      (default /tmp/txiki.js/build/tjs).

Every line the harness writes to stdout is checked to be a well-formed protocol
message, which is the point of the exercise: stdout is the wire and nothing else
may appear on it.
"""

import json
import os
import pathlib
import subprocess
import sys
import threading

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_TJS = os.environ.get("TJS", "/tmp/txiki.js/build/tjs")
HN_FIXTURE = HERE / "fixtures" / "hn-front.html"

FAILURES = []


def check(label, condition, detail=""):
    status = "ok  " if condition else "FAIL"
    print(f"    [{status}] {label}" + (f" -- {detail}" if detail else ""))
    if not condition:
        FAILURES.append(label)


class Harness:
    """A host-side connection to one harness child process."""

    def __init__(self, plugin, routes=None, ui_answers=None):
        self.plugin = str(plugin)
        self.routes = routes or []
        self.ui_answers = ui_answers or {}
        self.storage = {}
        self.next_id = 1
        self.transcript = []
        self.logs = []
        self.http_calls = []
        self.ui_calls = []
        self.stderr_lines = []
        self.protocol_errors = []

        self.proc = subprocess.Popen(
            [DEFAULT_TJS, "run", str(HERE / "harness.js"), self.plugin],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stderr_thread.start()

    # -- plumbing ---------------------------------------------------------

    def _drain_stderr(self):
        for line in self.proc.stderr:
            self.stderr_lines.append(line.rstrip("\n"))

    def _send(self, obj):
        self.transcript.append(("host->plugin", obj))
        self.proc.stdin.write(json.dumps(obj) + "\n")
        self.proc.stdin.flush()

    def _read_message(self):
        line = self.proc.stdout.readline()

        if line == "":
            raise EOFError(f"harness closed stdout (exit={self.proc.poll()})")

        line = line.rstrip("\n")

        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            self.protocol_errors.append(f"stdout line is not JSON: {line!r} ({exc})")
            raise AssertionError(f"stdout line is not JSON: {line!r}")

        if not isinstance(message, dict) or "id" not in message:
            self.protocol_errors.append(f"stdout line is not a protocol message: {line!r}")
            raise AssertionError(f"stdout line is not a protocol message: {line!r}")

        return message

    def _service(self, request):
        """Answer a plugin -> host request, then return."""
        self.transcript.append(("plugin->host", request))

        method = request.get("method")
        params = request.get("params") or {}

        if method == "http":
            result = self._serve_http(params)
        elif method == "ui":
            self.ui_calls.append(params)
            answer = self.ui_answers.get(params.get("kind"))
            # A callable is given the request, so an answer that depends on
            # what was asked — whether this URL is one the host would open —
            # can be written here rather than guessed in the fixture.
            result = answer(params) if callable(answer) else answer
        elif method == "storage.get":
            result = self.storage.get(params.get("key"))
        elif method == "storage.set":
            self.storage[params.get("key")] = params.get("value")
            result = None
        elif method == "log":
            self.logs.append(params)
            result = None
        else:
            self._send({"id": request["id"], "error": {"message": f"fake host: unknown method {method}"}})
            return

        self._send({"id": request["id"], "result": result})

    def _serve_http(self, params):
        self.http_calls.append(params)

        for needle, response in self.routes:
            if needle in params.get("url", ""):
                return response

        return {"status": 404, "headers": {"content-type": "text/plain"}, "body": "fake host: no route"}

    # -- protocol ---------------------------------------------------------

    def request(self, method, params=None):
        request_id = self.next_id
        self.next_id += 1

        self._send({"id": request_id, "method": method, "params": params or {}})

        while True:
            message = self._read_message()

            # A request carries `method`; a response never does.
            if isinstance(message.get("method"), str):
                self._service(message)
                continue

            if message.get("id") != request_id:
                raise AssertionError(f"response id {message.get('id')} does not match request id {request_id}")

            return message

    def result(self, method, params=None):
        message = self.request(method, params)

        if "error" in message:
            raise AssertionError(f"{method} returned an error: {message['error']}")

        return message["result"]

    def close(self):
        """Close stdin and wait for the harness to leave on its own."""
        try:
            self.proc.stdin.close()
        except (BrokenPipeError, ValueError):
            pass

        try:
            code = self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            code = self.proc.wait()

        self._stderr_thread.join(timeout=5)

        return code

    def dump(self, title):
        print(f"\n  --- {title} ---")

        for direction, message in self.transcript:
            arrow = "H -> P" if direction == "host->plugin" else "P -> H"
            print(f"    {arrow}  {json.dumps(message)}")


def entry_payload(result):
    """Probe plugins report through `entries[0].content`, since `fetch` may only
    return `{entries, cursor}`."""
    return json.loads(result["entries"][0]["content"])


def hn_routes():
    body = HN_FIXTURE.read_text()
    page_two = body.replace("id='41234567'", "id='41999999'").replace(
        "Rust at scale: lessons from a rewrite", "Page two story"
    ).replace('<a href="news?p=2" class="morelink" rel="nofollow">More</a>', "")

    return [
        ("news?p=2", {"status": 200, "headers": {"content-type": "text/html"}, "body": page_two}),
        ("news.ycombinator.com", {"status": 200, "headers": {"content-type": "text/html"}, "body": body}),
    ]


# -- scenarios ------------------------------------------------------------


def scenario_describe(plugin):
    print("\n== describe ==")
    host = Harness(plugin, hn_routes())

    try:
        result = host.result("describe")
    finally:
        host.close()

    host.dump("describe")
    check("result has `meta` and `settings`", set(result) == {"meta", "settings"}, str(sorted(result)))
    check("meta.id", result["meta"]["id"] == "hacker-news", result["meta"]["id"])
    check("meta.view", result["meta"]["view"] == "articles", result["meta"]["view"])
    check("settings.fields is a list", isinstance(result["settings"]["fields"], list))
    check("describe made no http call", host.http_calls == [], str(host.http_calls))

    return host


def scenario_fetch(plugin):
    print("\n== fetch (plugin calls back into the host for http) ==")
    host = Harness(plugin, hn_routes())

    try:
        result = host.result("fetch", {"settings": {"limit": 30, "minPoints": 0}, "params": {"feed": "top"}, "cursor": None})
    finally:
        host.close()

    host.dump("fetch")
    entries = result["entries"]

    check("entries is a list", isinstance(entries, list), str(type(entries)))
    check("three entries parsed", len(entries) == 3, str(len(entries)))
    check("host serviced the plugin's http call", len(host.http_calls) == 1, str(len(host.http_calls)))
    check("plugin's log reached the host", len(host.logs) >= 1, str(host.logs))

    if len(entries) == 3:
        first = entries[0]
        check("entry id is namespaced and stable", first["id"] == "hn:41234567", first["id"])
        check("title decoded", first["title"] == "Rust at scale: lessons from a rewrite", first["title"])
        check("url", first["url"] == "https://example.com/rust-at-scale", first["url"])
        check("author", first.get("author") == "pg", str(first.get("author")))
        check("publishedAt is unix seconds", first.get("publishedAt") == 1717236000, str(first.get("publishedAt")))
        check("summary", first.get("summary") == "412 points · 87 comments", str(first.get("summary")))

        second = entries[1]
        check("relative link made absolute", second["url"] == "https://news.ycombinator.com/item?id=41234568", second["url"])

        third = entries[2]
        check("entities decoded", third["title"] == "Tabs & spaces: a 40'year 'war' ends", third["title"])
        check("entity in query kept", "a=1&b=2" in third["url"], third["url"])
        check("singular '1 point' parsed", third.get("summary") == "1 point", str(third.get("summary")))

    check("cursor is HN's More link", result["cursor"] == "news?p=2", str(result["cursor"]))

    return host


def scenario_paginate(plugin):
    print("\n== paginate (cursor round-trips through the host) ==")
    host = Harness(plugin, hn_routes())

    try:
        first = host.result("fetch", {"settings": {"limit": 30}, "params": {"feed": "top"}, "cursor": None})
        second = host.result("fetch", {"settings": {"limit": 30}, "params": {"feed": "top"}, "cursor": first["cursor"]})
    finally:
        host.close()

    host.dump("paginate")
    check("first page cursor", first["cursor"] == "news?p=2", str(first["cursor"]))
    check("second request followed the cursor", "news?p=2" in host.http_calls[-1]["url"], host.http_calls[-1]["url"])
    check("second page parsed", second["entries"][0]["title"] == "Page two story", second["entries"][0]["title"])
    check("last page has no cursor", second["cursor"] is None, str(second["cursor"]))

    return host


def scenario_lifecycle(plugin):
    print("\n== activate / deactivate ==")
    host = Harness(plugin, hn_routes())

    try:
        activated = host.result("activate", {"settings": {}, "params": {"feed": "best"}})
        deactivated = host.result("deactivate", {})
    finally:
        host.close()

    host.dump("lifecycle")
    check("activate returns null", activated is None, str(activated))
    check("deactivate returns null", deactivated is None, str(deactivated))
    check("activate logged", any("activated" in entry["message"] for entry in host.logs), str(host.logs))

    return host


def scenario_error(plugin):
    print("\n== error path (plugin throws) ==")
    host = Harness(plugin, hn_routes())

    try:
        message = host.request("fetch", {"settings": {}, "params": {}, "cursor": None})
    finally:
        code = host.close()

    host.dump("error")
    check("response carries `error`", "error" in message, str(message))
    check("no `result` alongside the error", "result" not in message, str(message))

    if "error" in message:
        text = message["error"]["message"]
        check("error names the failure", "boom from the plugin" in text, text)
        check("error carries the plugin's stack", "at fetch" in text or "throws.js" in text, text)

    check("harness still exited cleanly", code == 0, str(code))

    return host


def scenario_unknown(plugin):
    print("\n== unknown method ==")
    host = Harness(plugin, hn_routes())

    try:
        message = host.request("nonsense", {})
    finally:
        host.close()

    check("unknown method is an error response", "error" in message, str(message))
    check("message names the method", "nonsense" in message.get("error", {}).get("message", ""), str(message))

    return host


def scenario_globals(plugin):
    print("\n== global hardening (what a plugin can reach) ==")
    host = Harness(plugin)

    try:
        result = host.result("fetch", {"settings": {}, "params": {}, "cursor": None})
    finally:
        host.close()

    host.dump("globals")

    result = entry_payload(result)
    present = result["present"]

    for name in ["XMLHttpRequest", "WebSocket", "WebSocketStream", "WebSocketError", "EventSource",
                 "TCPSocket", "TLSSocket", "UDPSocket", "PipeSocket",
                 "TCPServerSocket", "TLSServerSocket", "PipeServerSocket",
                 "Worker", "BroadcastChannel", "WebAssembly", "localStorage", "sessionStorage"]:
        check(f"{name} removed", name not in present, "still present" if name in present else "")

    for name in ["crypto", "URL", "URLSearchParams", "structuredClone", "TextDecoder",
                 "Blob", "MessageChannel", "performance", "atob", "setTimeout"]:
        check(f"{name} kept", name in present, "missing" if name not in present else "")

    check("`fetch` global is the host shim", result["fetchIsHostShim"] is True, str(result["fetchIsHostShim"]))
    check("`Response` is the host shim", result["responseName"] == "HostResponse", str(result["responseName"]))
    check("`Request` is the host shim", result["requestName"] == "HostRequest", str(result["requestName"]))
    check("`Headers` is the host shim", result["headersName"] == "HostHeaders", str(result["headersName"]))
    check("alert/confirm/prompt are globals", all(result["uiGlobals"].values()), str(result["uiGlobals"]))
    check("`tjs` is unavoidably reachable (documented)", "tjs" in present, "")
    check("`navigator` is unavoidably reachable (documented)", "navigator" in present, "")

    logged = [entry["message"] for entry in host.logs]
    check("console.log reached the host, not stdout", "console-probe" in logged, str(logged))
    check("print() reached the host, not stdout", "print-probe" in logged, str(logged))

    return host


def scenario_hostapi(plugin):
    print("\n== storage / ui / headers / errors from the host ==")
    routes = [
        ("json", {"status": 200, "headers": {"Content-Type": "application/json"}, "body": '{"hello":"world"}'}),
        ("teapot", {"status": 418, "headers": {"content-type": "text/plain"}, "body": "short and stout"}),
        ("missing", {"status": 404, "headers": {}, "body": ""}),
    ]
    def open_external(params):
        # The same rule the real host applies: the URL came from the plugin, so
        # only the two schemes a browser is for are handed to the opener.
        return {"opened": params.get("url", "").startswith(("http://", "https://"))}

    host = Harness(plugin, routes, ui_answers={
        "confirm": True,
        "prompt": "s3cret",
        "alert": None,
        "openExternal": open_external,
    })

    try:
        result = host.result("fetch", {"settings": {}, "params": {}, "cursor": None})
    finally:
        host.close()

    host.dump("hostapi")

    result = entry_payload(result)

    check("storage round-tripped through the host", host.storage.get("probe") == {"nested": [1, 2, 3]}, str(host.storage))
    check("storage.get of a missing key is null", result["missingKey"] is None, str(result["missingKey"]))
    check("json response parsed", result["json"] == {"hello": "world"}, str(result["json"]))
    check("ok is false for 418", result["teapotOk"] is False, str(result["teapotOk"]))
    check("statusText for 418", result["teapotText"] == "I'm a Teapot", str(result["teapotText"]))
    check("headers.get is case-insensitive", result["contentType"] == "application/json", str(result["contentType"]))
    check("ok is false for 404", result["missingOk"] is False, str(result["missingOk"]))
    check("confirm resolved true", result["confirmed"] is True, str(result["confirmed"]))
    check("prompt returned the typed value", result["prompted"] == "s3cret", str(result["prompted"]))
    check("openExternal opened an https url", result["opened"] is True, str(result["opened"]))
    check("openExternal refused a file url", result["refused"] is False, str(result["refused"]))

    kinds = [call.get("kind") for call in host.ui_calls]
    check("ui calls reached the host", len(kinds) == 9, str(kinds))
    check("progress is reported, not asked", kinds.count("progress") == 3, str(kinds))
    check("the last progress clears the bar",
          host.ui_calls[6]["message"] is None and host.ui_calls[6]["value"] is None,
          str(host.ui_calls[6]))
    check("a progress value is carried through", host.ui_calls[5]["value"] == 0.75, str(host.ui_calls[5]))
    check("post body was sent as JSON", host.http_calls[1]["init"]["body"] == '{"a":1}', str(host.http_calls[1]["init"]))

    return host


def scenario_fetch_edges(plugin):
    print("\n== fetch shim edges ==")
    routes = [
        ("/json", {"status": 200, "headers": {"content-type": "application/json"}, "body": '{"hello":"world"}'}),
        ("/boom", {"status": 500, "headers": {"content-type": "text/plain"}, "body": "it broke"}),
    ]
    host = Harness(plugin, routes)

    try:
        result = host.result("fetch", {"settings": {}, "params": {}, "cursor": None})
    finally:
        host.close()

    host.dump("fetch edges")
    report = entry_payload(result)

    check("plain string url works", report["plainString"]["value"]["status"] == 200, str(report["plainString"]))
    check("statusText is filled in", report["plainString"]["value"]["statusText"] == "OK", str(report["plainString"]))
    check("url is echoed back", report["plainString"]["value"]["url"] == "https://probe.test/json", str(report["plainString"]))

    check("binary body refused", report["typedArrayBody"]["ok"] is False
          and "binary bodies" in report["typedArrayBody"]["error"], str(report["typedArrayBody"]))
    check("GET with body refused", report["getWithBody"]["ok"] is False
          and "cannot have a body" in report["getWithBody"]["error"], str(report["getWithBody"]))
    check("missing url refused", report["missingUrl"]["ok"] is False
          and "first argument" in report["missingUrl"]["error"], str(report["missingUrl"]))

    check("Request object accepted", report["requestObject"]["value"]["status"] == 200, str(report["requestObject"]))
    check("Request method upper-cased", report["requestObject"]["value"]["method"] == "POST", str(report["requestObject"]))
    check("URL object accepted", report["urlObject"]["value"] == 200, str(report["urlObject"]))
    check("Headers init accepted", report["headersInit"]["ok"] is True, str(report["headersInit"]))

    check("500 is not an error, just !ok", report["serverError"]["value"]["ok"] is False
          and report["serverError"]["value"]["text"] == "it broke", str(report["serverError"]))

    check("body is reusable", report["bodyIsReusable"]["value"]["second"] == '{"hello":"world"}'
          and report["bodyIsReusable"]["value"]["bodyUsed"] is False, str(report["bodyIsReusable"]))
    check("clone works", report["clone"]["value"]["copied"] == {"hello": "world"}, str(report["clone"]))
    check("new Response(body, init) works", report["constructResponse"]["value"] == {
        "ok": True, "status": 201, "header": "b", "text": "hi"
    }, str(report["constructResponse"]))

    sent = [call["init"] for call in host.http_calls]

    def headers_of(entry):
        return entry.get("headers") or {}

    check("URLSearchParams body encoded",
          any(entry.get("body") == "a=1" and "x-www-form-urlencoded" in headers_of(entry).get("content-type", "")
              for entry in sent), str(sent))
    check("object body sent as JSON",
          any(entry.get("body") == '{"a":1}' and headers_of(entry).get("content-type") == "application/json"
              for entry in sent), str(sent))
    check("Headers init lower-cased on the wire",
          any(headers_of(entry).get("x-test") == "1" for entry in sent), str(sent))
    check("GET requests carry no body",
          all(entry.get("body") is None for entry in sent if entry["method"] == "GET"), str(sent))

    return host


def scenario_concurrent(plugin):
    print("\n== two requests in flight at once ==")
    host = Harness(plugin, hn_routes())

    # Both go out before either answer comes back, so the plugin's http call
    # arrives while two handlers are outstanding.
    host._send({"id": 1, "method": "describe", "params": {}})
    host._send({"id": 2, "method": "fetch", "params": {"settings": {}, "params": {}, "cursor": None}})

    responses = {}

    while len(responses) < 2:
        message = host._read_message()

        if isinstance(message.get("method"), str):
            host._service(message)
            continue

        responses[message["id"]] = message

    host.close()

    check("both responses arrived", set(responses) == {1, 2}, str(sorted(responses)))
    check("describe answered", responses[1]["result"]["meta"]["id"] == "hacker-news", str(responses[1])[:80])
    check("fetch answered", len(responses[2]["result"]["entries"]) == 3, str(responses[2])[:80])

    return host


def scenario_shutdown(plugin):
    print("\n== shutdown: request, then stdin closed immediately (flush must not truncate) ==")
    host = Harness(plugin)

    host._send({"id": 1, "method": "fetch", "params": {"settings": {}, "params": {}, "cursor": None}})
    host.proc.stdin.close()

    lines = [line for line in host.proc.stdout]
    code = host.close()

    check("harness exited cleanly", code == 0, str(code))
    check("exactly one response line", len(lines) == 1, str(len(lines)))

    if lines:
        check("line was not cut off", lines[0].endswith("\n"), repr(lines[0][-24:]))

        try:
            entries = json.loads(lines[0])["result"]["entries"]
        except (json.JSONDecodeError, KeyError) as exc:
            check("response is complete JSON", False, f"{exc}: {lines[0][-40:]!r}")
            return host

        check("all 200 entries flushed before exit", len(entries) == 200, str(len(entries)))
        check("last entry intact", len(entries[-1]["content"]) == 4096, str(len(entries[-1]["content"])))

    return host


def scenario_bad_meta(plugin):
    print("\n== describe rejects a plugin with no usable meta ==")
    host = Harness(plugin)

    try:
        message = host.request("describe")
    finally:
        host.close()

    host.dump("bad meta")
    check("response carries `error`", "error" in message, str(message))
    check("error explains the missing id",
          "meta.id" in message.get("error", {}).get("message", ""),
          message.get("error", {}).get("message", ""))

    return host


SCENARIOS = {
    "describe": ("examples/hacker-news.js", scenario_describe),
    "fetch": ("examples/hacker-news.js", scenario_fetch),
    "paginate": ("examples/hacker-news.js", scenario_paginate),
    "lifecycle": ("examples/hacker-news.js", scenario_lifecycle),
    "error": ("fixtures/plugins/throws.js", scenario_error),
    "unknown": ("examples/hacker-news.js", scenario_unknown),
    "globals": ("fixtures/plugins/globals.js", scenario_globals),
    "hostapi": ("fixtures/plugins/host-api.js", scenario_hostapi),
    "badmeta": ("fixtures/plugins/bad-meta.js", scenario_bad_meta),
    "fetchedges": ("fixtures/plugins/fetch-edges.js", scenario_fetch_edges),
    "concurrent": ("examples/hacker-news.js", scenario_concurrent),
    "shutdown": ("fixtures/plugins/large.js", scenario_shutdown),
}


def main():
    args = sys.argv[1:]
    scenario = "all"
    plugin = None

    if args and (args[0] in SCENARIOS or args[0] == "all"):
        scenario = args.pop(0)

    if args:
        plugin = pathlib.Path(args[0])

        if not plugin.is_absolute():
            plugin = pathlib.Path.cwd() / plugin

        if not plugin.exists():
            print(f"no such plugin: {plugin}")
            return 2

    if scenario != "all" and scenario not in SCENARIOS:
        print(f"unknown scenario {scenario!r}; try one of {', '.join(SCENARIOS)} or all")
        return 2

    names = list(SCENARIOS) if scenario == "all" else [scenario]
    stderr_seen = []

    for name in names:
        default_plugin, run = SCENARIOS[name]
        target = plugin if plugin else HERE / default_plugin

        print(f"\n===== {name}: {target.name} =====")

        host = run(target)

        stderr_seen.extend(host.stderr_lines)

        if host.protocol_errors:
            check(f"{name}: stdout carried only protocol messages", False, "; ".join(host.protocol_errors))

    print("\n===== stderr from the harness (diagnostics only) =====")

    for line in stderr_seen:
        print(f"    {line}")

    if FAILURES:
        print(f"\n{len(FAILURES)} CHECK(S) FAILED:")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1

    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
