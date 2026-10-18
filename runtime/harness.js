/**
 * Rome plugin runtime harness.
 *
 * This file is one half of a frozen protocol. The other half is the Rust host
 * in `src/`. It runs inside a txiki.js child process:
 *
 *     tjs run /path/to/runtime/harness.js /path/to/plugin.js
 *
 * (note the `run` subcommand -- `tjs <file>` only prints usage).
 *
 * Wire format: newline-delimited JSON on stdin/stdout, one object per line.
 * stdout carries the protocol and nothing else; all diagnostics go to stderr.
 *
 *     Request:  {"id": <u64>, "method": "<name>", "params": <object>}
 *     Response: {"id": <u64>, "result": <any>}
 *               {"id": <u64>, "error": {"message": "<string>"}}
 *
 * Host -> plugin:  describe / fetch / preview / activate / deactivate
 * Plugin -> host:  http / ui / storage.get / storage.set / log
 *
 * The crux is that plugin -> host requests arrive *while* the host is waiting
 * for a plugin response. The read loop below therefore never blocks on a
 * handler: it dispatches each request and immediately goes back to reading, so
 * a pending `ctx.fetch(...)` inside the plugin can be serviced. Replies to
 * outstanding plugin -> host requests are matched by id through `pendingHost`.
 *
 * Plugin -> host request ids are allocated from `HOST_ID_BASE` so they can never
 * collide with the host's own id space.
 */

import path from "tjs:path";

// ---------------------------------------------------------------------------
// stdio
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const stdoutWriter = tjs.stdout.getWriter();
const stderrWriter = tjs.stderr.getWriter();

/** Serialised so that concurrent writers cannot interleave a line. */
let stdoutChain = Promise.resolve();

/** Harness diagnostics. Never touches stdout -- stdout is the wire. */
function diag(message) {
    try {
        stderrWriter.write(encoder.encode(String(message) + "\n")).catch(() => {});
    } catch {
        // stderr is gone; there is nowhere left to report that.
    }
}

function writeLine(line) {
    const bytes = encoder.encode(line + "\n");
    const write = () => stdoutWriter.write(bytes);

    stdoutChain = stdoutChain.then(write, write).catch(err => {
        diag("harness: stdout write failed: " + describeError(err));
    });

    return stdoutChain;
}

function writeMessage(payload) {
    let line;

    try {
        line = JSON.stringify(payload);
    } catch (err) {
        line = JSON.stringify({
            id: payload && payload.id !== undefined ? payload.id : null,
            error: { message: "response is not JSON-serializable: " + describeError(err) }
        });
    }

    if (line === undefined) {
        line = JSON.stringify({
            id: payload && payload.id !== undefined ? payload.id : null,
            error: { message: "response is not JSON-serializable" }
        });
    }

    writeLine(line);
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

function describeError(err) {
    if (err === null || err === undefined) {
        return String(err);
    }

    if (err instanceof Error) {
        const headline = `${err.name || "Error"}: ${err.message}`;

        // This build of QuickJS-ng gives `stack` as the frame list only -- it
        // does not repeat the headline the way V8 and SpiderMonkey do -- so the
        // message has to be put back. `startsWith` keeps it correct either way.
        if (typeof err.stack === "string" && err.stack !== "") {
            return err.stack.startsWith(headline) ? err.stack : `${headline}\n${err.stack}`;
        }

        return headline;
    }

    if (typeof err === "string") {
        return err;
    }

    try {
        const json = JSON.stringify(err);

        return json === undefined ? String(err) : json;
    } catch {
        return String(err);
    }
}

// ---------------------------------------------------------------------------
// plugin -> host calls
// ---------------------------------------------------------------------------

/**
 * Plugin -> host ids start well above any id a host counter would reach, so the
 * two id spaces cannot collide even for a host that matched naively by id.
 */
const HOST_ID_BASE = 2 ** 40;
let nextHostId = HOST_ID_BASE;

/** id -> { resolve, reject } for host calls awaiting a reply. */
const pendingHost = new Map();

/** Set once stdin has closed: nothing can be answered after that. */
let shuttingDown = false;

function hostCall(method, params) {
    if (shuttingDown) {
        return Promise.reject(new Error("the host connection is closed"));
    }

    const id = nextHostId++;
    let line;

    try {
        line = JSON.stringify({ id, method, params: params === undefined ? {} : params });
    } catch (err) {
        return Promise.reject(
            new TypeError(`cannot call host method \`${method}\`: params are not JSON-serializable: ${describeError(err)}`)
        );
    }

    return new Promise((resolve, reject) => {
        pendingHost.set(id, { resolve, reject });
        writeLine(line);
    });
}

function settleHostCall(message) {
    const entry = pendingHost.get(message.id);

    if (!entry) {
        diag(`harness: reply for unknown request id ${message.id}`);
        return;
    }

    pendingHost.delete(message.id);

    if (message.error !== undefined && message.error !== null) {
        const info = message.error;
        const text = (info && typeof info === "object")
            ? (info.message !== undefined ? String(info.message) : JSON.stringify(info))
            : String(info);

        const err = new Error(text);

        err.name = "HostError";
        entry.reject(err);
    } else {
        entry.resolve(message.result);
    }
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

const STATUS_TEXT = {
    200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified",
    307: "Temporary Redirect", 308: "Permanent Redirect",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 408: "Request Timeout", 409: "Conflict",
    410: "Gone", 418: "I'm a Teapot", 422: "Unprocessable Entity",
    429: "Too Many Requests", 451: "Unavailable For Legal Reasons",
    500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
    503: "Service Unavailable", 504: "Gateway Timeout"
};

class HostHeaders {
    #entries = new Map();

    constructor(init) {
        if (init === undefined || init === null) {
            return;
        }

        if (init instanceof HostHeaders) {
            for (const [name, value] of init.#entries) {
                this.#entries.set(name, value);
            }

            return;
        }

        if (Array.isArray(init)) {
            for (const pair of init) {
                if (Array.isArray(pair) && pair.length >= 2) {
                    this.append(pair[0], pair[1]);
                }
            }

            return;
        }

        if (typeof init === "object") {
            for (const name of Object.keys(init)) {
                const value = init[name];

                if (value === undefined || value === null) {
                    continue;
                }

                if (Array.isArray(value)) {
                    for (const item of value) {
                        this.append(name, item);
                    }
                } else {
                    this.append(name, value);
                }
            }

            return;
        }

        throw new TypeError("Headers: unsupported initializer");
    }

    append(name, value) {
        const key = String(name).toLowerCase();
        const text = String(value);
        const existing = this.#entries.get(key);

        this.#entries.set(key, existing === undefined ? text : `${existing}, ${text}`);
    }

    set(name, value) {
        this.#entries.set(String(name).toLowerCase(), String(value));
    }

    get(name) {
        const value = this.#entries.get(String(name).toLowerCase());

        return value === undefined ? null : value;
    }

    has(name) {
        return this.#entries.has(String(name).toLowerCase());
    }

    delete(name) {
        return this.#entries.delete(String(name).toLowerCase());
    }

    *entries() {
        yield* this.#entries.entries();
    }

    *keys() {
        yield* this.#entries.keys();
    }

    *values() {
        yield* this.#entries.values();
    }

    forEach(callback, thisArg) {
        for (const [name, value] of this.#entries) {
            callback.call(thisArg, value, name, this);
        }
    }

    [Symbol.iterator]() {
        return this.entries();
    }
}

function headersToObject(headers) {
    const out = {};

    for (const [name, value] of headers) {
        out[name] = value;
    }

    return out;
}

/**
 * The host returns `{status, headers, body}` where body is a string. This is the
 * smallest object that still reads like a real `Response`.
 *
 * Deviation from the platform: the body is not a one-shot stream. `text()` and
 * `json()` may be called any number of times, and `bodyUsed` is always false.
 * A cached string is friendlier than the streaming footgun, and there is no
 * stream to hand out anyway.
 */
/**
 * Bodies only ever travel as a UTF-8 string, so this is the whole of body
 * handling. A stream or a Blob is refused rather than stringified into
 * "[object ReadableStream]".
 */
function bodyToString(body) {
    if (body === null || body === undefined) {
        return "";
    }

    if (typeof body === "string") {
        return body;
    }

    if (body instanceof URLSearchParams) {
        return body.toString();
    }

    if (body instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(body));
    }

    if (ArrayBuffer.isView(body)) {
        return decoder.decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    }

    throw new TypeError("Response: bodies are UTF-8 strings; encode anything else yourself");
}

class HostResponse {
    #status;
    #headers;
    #body;
    #url;

    /** `new Response(body, init)`, so the global behaves like the real thing. */
    constructor(body = null, init = {}) {
        this.#status = Number.isFinite(Number(init.status)) ? Number(init.status) : 200;
        this.#headers = new HostHeaders(init.headers);
        this.#body = bodyToString(body);
        this.#url = typeof init.url === "string" ? init.url : "";
    }

    /** Built from a host `http` reply: {status, headers, body, url}. */
    static fromHostReply(reply, url) {
        const response = new HostResponse(reply.body, { status: reply.status, headers: reply.headers, url });

        return response;
    }

    get ok() {
        return this.#status >= 200 && this.#status <= 299;
    }

    get status() {
        return this.#status;
    }

    get statusText() {
        return STATUS_TEXT[this.#status] || "";
    }

    get headers() {
        return this.#headers;
    }

    get url() {
        return this.#url;
    }

    get redirected() {
        return false;
    }

    get type() {
        return "basic";
    }

    get bodyUsed() {
        return false;
    }

    get body() {
        return null;
    }

    async text() {
        return this.#body;
    }

    async json() {
        return JSON.parse(this.#body);
    }

    async arrayBuffer() {
        const bytes = encoder.encode(this.#body);

        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }

    async blob() {
        return new Blob([this.#body]);
    }

    clone() {
        return new HostResponse(this.#body, { status: this.#status, headers: this.#headers, url: this.#url });
    }
}

class HostRequest {
    constructor(input, init = {}) {
        if (input instanceof HostRequest) {
            this.url = input.url;
            this.method = input.method;
            this.headers = new HostHeaders(input.headers);
            this.body = input.body;

            return;
        }

        this.url = String(input instanceof URL ? input.href : input);
        this.method = (init.method ? String(init.method) : "GET").toUpperCase();
        this.headers = new HostHeaders(init.headers);
        this.body = init.body === undefined ? null : init.body;
    }
}

function normalizeBody(body, headers) {
    if (body === undefined || body === null) {
        return null;
    }

    if (typeof body === "string") {
        return body;
    }

    if (body instanceof URLSearchParams) {
        if (!headers.has("content-type")) {
            headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
        }

        return body.toString();
    }

    // The wire carries the body as a JSON string, so it is UTF-8 text and
    // nothing else. Anything binary is refused loudly rather than mangled.
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof Blob) {
        throw new TypeError(
            "fetch: binary bodies are not supported by the plugin protocol (the host carries `body` as a UTF-8 string); " +
            "encode it yourself, e.g. with TextDecoder"
        );
    }

    if (typeof body === "object") {
        if (!headers.has("content-type")) {
            headers.set("content-type", "application/json");
        }

        return JSON.stringify(body);
    }

    throw new TypeError(`fetch: unsupported body type: ${typeof body}`);
}

function normalizeRequest(input, init = {}) {
    let url = null;
    let method = "GET";
    let headers = new HostHeaders();
    let body = null;

    if (input instanceof HostRequest) {
        url = input.url;
        method = input.method;
        headers = new HostHeaders(input.headers);
        body = input.body;
    } else if (input instanceof URL) {
        url = input.href;
    } else if (typeof input === "string") {
        url = input;
    } else if (input !== null && typeof input === "object" && typeof input.url === "string") {
        url = input.url;
        method = input.method ? String(input.method).toUpperCase() : "GET";
        headers = new HostHeaders(input.headers);

        if (input.body !== undefined) {
            body = input.body;
        }
    } else {
        throw new TypeError("fetch: first argument must be a URL string, a URL, or a Request");
    }

    if (!url) {
        throw new TypeError("fetch: missing URL");
    }

    if (init.method !== undefined) {
        method = String(init.method).toUpperCase();
    }

    if (init.headers !== undefined) {
        for (const [name, value] of new HostHeaders(init.headers)) {
            headers.append(name, value);
        }
    }

    if (init.body !== undefined) {
        body = init.body;
    }

    const normalizedBody = normalizeBody(body, headers);

    if ((method === "GET" || method === "HEAD") && normalizedBody !== null) {
        throw new TypeError(`fetch: ${method} request cannot have a body`);
    }

    return { url, method, headers, body: normalizedBody };
}

/**
 * `ctx.fetch(url, init)` and the `fetch` global. Everything goes through the
 * host so the request picks up the cookie jar, the proxy and the per-plugin
 * request log. No URL is blocked or rewritten.
 */
async function hostFetch(input, init) {
    const { url, method, headers, body } = normalizeRequest(input, init);
    const requestInit = { method };

    const headerObject = headersToObject(headers);

    if (Object.keys(headerObject).length > 0) {
        requestInit.headers = headerObject;
    }

    if (body !== null) {
        requestInit.body = body;
    }

    const reply = await hostCall("http", { url, init: requestInit });

    if (reply === null || typeof reply !== "object") {
        throw new Error("host `http` returned a malformed reply (expected an object)");
    }

    if (!Number.isFinite(Number(reply.status))) {
        throw new Error("host `http` reply is missing a numeric `status`");
    }

    return HostResponse.fromHostReply(reply, url);
}

// ---------------------------------------------------------------------------
// log
// ---------------------------------------------------------------------------

function formatValue(value) {
    if (typeof value === "string") {
        return value;
    }

    if (value instanceof Error) {
        return describeError(value);
    }

    try {
        const json = JSON.stringify(value);

        return json === undefined ? String(value) : json;
    } catch {
        return String(value);
    }
}

function formatArgs(args) {
    return args.map(formatValue).join(" ");
}

function sendLog(level, message) {
    // Fire and forget, but still registered: the host answers every request, and
    // an unregistered reply would look like a protocol violation.
    hostCall("log", { level, message }).catch(() => {});
}

/** Callable as `ctx.log("hi")` and usable as `ctx.log.warn("hi")`. */
const log = (message, level = "info") => sendLog(level, formatValue(message));

for (const level of ["debug", "info", "warn", "error"]) {
    log[level] = message => sendLog(level, formatValue(message));
}

const hostConsole = {
    log: (...args) => sendLog("info", formatArgs(args)),
    info: (...args) => sendLog("info", formatArgs(args)),
    debug: (...args) => sendLog("debug", formatArgs(args)),
    warn: (...args) => sendLog("warn", formatArgs(args)),
    error: (...args) => sendLog("error", formatArgs(args)),
    trace: (...args) => sendLog("debug", "trace: " + formatArgs(args)),
    dir: (...args) => sendLog("debug", formatArgs(args)),
    group: (...args) => sendLog("info", formatArgs(args)),
    groupCollapsed: (...args) => sendLog("info", formatArgs(args)),
    groupEnd: () => {},
    assert: (condition, ...args) => {
        if (!condition) {
            sendLog("error", "assertion failed: " + formatArgs(args));
        }
    }
};

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

const storage = {
    async get(key) {
        const value = await hostCall("storage.get", { key: String(key) });

        return value === undefined ? null : value;
    },

    async set(key, value) {
        const payload = value === undefined ? null : value;

        try {
            JSON.stringify(payload);
        } catch (err) {
            throw new TypeError(`storage.set: value is not JSON-serializable: ${describeError(err)}`);
        }

        await hostCall("storage.set", { key: String(key), value: payload });
    }
};

// ---------------------------------------------------------------------------
// ui
// ---------------------------------------------------------------------------

/**
 * All of these are async, and they have to be.
 *
 * A host dialog is answered over the same stdin the plugin runtime reads, and
 * this runtime is single-threaded: blocking the thread to wait for that reply
 * would stop the read loop that delivers it, so a synchronous `confirm()` could
 * never return. txiki.js also refuses to block the main thread at all --
 * `Atomics.wait` throws `TypeError: cannot block in this thread`, so the
 * worker/SharedArrayBuffer escape hatch is closed too.
 *
 * `alert()` is safe to call without `await` (it is fire-and-forget in every
 * browser, too). `confirm()` and `prompt()` need `await` to see their result.
 */
const ui = {
    alert: message => hostCall("ui", { kind: "alert", message: formatValue(message) }).then(() => undefined),

    confirm: message => hostCall("ui", { kind: "confirm", message: formatValue(message) }).then(Boolean),

    prompt: (message, options = {}) => hostCall("ui", {
        kind: "prompt",
        message: formatValue(message),
        title: options.title === undefined ? null : String(options.title),
        placeholder: options.placeholder === undefined ? null : String(options.placeholder),
        secret: Boolean(options.secret)
    }).then(value => (value === undefined || value === null ? null : String(value))),

    notify: (message, level = "info") => hostCall("ui", {
        kind: "notify",
        message: formatValue(message),
        level: String(level)
    }).then(() => undefined),

    form: schema => hostCall("ui", { kind: "form", schema }).then(value => (value === undefined ? null : value)),

    pick: items => hostCall("ui", { kind: "pick", items }).then(value => (value === undefined ? null : value)),

    /**
     * Sign in to `url` in a native window.
     *
     * Resolves `true` when the user says they are finished. The cookies the
     * page collected are in the jar before this resolves, so the `fetch` that
     * follows is authenticated — that ordering is the whole reason this is a
     * host call rather than "open a URL and hope".
     *
     * Accepts a URL or `{ url }`, so the common case is `await ctx.ui.login(url)`.
     */
    login: options => hostCall("ui", {
        kind: "login",
        url: String(typeof options === "string" ? options : options.url)
    }).then(value => Boolean(value && value.finished)),

    /**
     * Say how far along a long job is. Does not wait for anyone.
     *
     * `value` is 0..1, or omitted for a job whose size is not known yet — the
     * bar then reads as "working" rather than as "0%". Each call replaces the
     * last, so calling it in a loop is one bar filling up rather than a stack
     * of toasts.
     *
     * `progress(null)` takes it down. Nothing else does: a bar that hid itself
     * on a timer would vanish under a job that is still running, which is
     * exactly when the reader needs it. Every path out of a long loop has to
     * clear it, including the `catch`.
     */
    progress: (message, value) => hostCall("ui", {
        kind: "progress",
        message: message === undefined || message === null ? null : formatValue(message),
        value: typeof value === "number" && Number.isFinite(value) ? value : null
    }).then(() => undefined),

    /**
     * Open `url` in the reader's own browser.
     *
     * Resolves `true` if it was handed over. Only http(s) opens: anything else
     * is refused, because the URL came from the plugin rather than from the
     * person who would be clicking it.
     */
    openExternal: url => hostCall("ui", { kind: "openExternal", url: String(url) })
        .then(value => Boolean(value && value.opened))
};

// ---------------------------------------------------------------------------
// global hardening
// ---------------------------------------------------------------------------

/**
 * Everything below is removed or replaced *before* the plugin module is
 * imported, because a module can touch globals at its top level.
 *
 * The trust model is "the user audits the plugin themselves" -- this is not an
 * adversarial sandbox. It is hygiene: a plugin should not be able to reach
 * capabilities by accident, and there should be exactly one way to do each
 * thing, so that the host's cookie jar, request log and storage stay in the
 * loop.
 */
const REMOVED_GLOBALS = [
    // Network. Each of these opens a connection the host never sees, which
    // silently loses the cookie jar, the proxy and the request log. `fetch`
    // itself is replaced below rather than deleted.
    "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebSocketError", "EventSource",
    // Raw sockets.
    "TCPSocket", "TLSSocket", "UDPSocket", "PipeSocket",
    "TCPServerSocket", "TLSServerSocket", "PipeServerSocket",
    // A worker gets a fresh realm with its own `tjs` and its own globals, so it
    // is an escape from every rule in this file. `BroadcastChannel` only exists
    // to talk between realms and is inert without workers.
    "Worker", "BroadcastChannel",
    // WebAssembly is reachable compute with no plugin use case: a plugin is one
    // ES module, so a .wasm blob would have to be base64-embedded. Removing it
    // keeps the capability surface honest. Trivial to restore if a plugin ever
    // needs it.
    "WebAssembly",
    // Two storage stories is one too many. These are also per-process, so they
    // silently lose data on restart; `ctx.storage` is host-backed and durable.
    "localStorage", "sessionStorage"
];

/** Engine globals that are defined non-configurable and so cannot be removed. */
const UNDELETABLE_GLOBALS = ["tjs", "navigator", "self"];

function hardenGlobals() {
    // One fetch, one Response, one Headers. The native `fetch` is overwritten
    // rather than shadowed, so it is not reachable under any other name.
    globalThis.fetch = hostFetch;
    globalThis.Headers = HostHeaders;
    globalThis.Response = HostResponse;
    globalThis.Request = HostRequest;

    globalThis.console = hostConsole;

    // `print` writes straight to stdout in QuickJS builds that define it, which
    // would corrupt the wire. Alias it to the host log.
    globalThis.print = (...args) => sendLog("info", formatArgs(args));

    globalThis.alert = ui.alert;
    globalThis.confirm = ui.confirm;
    globalThis.prompt = ui.prompt;

    const survivors = [];

    for (const name of REMOVED_GLOBALS) {
        try {
            if (!delete globalThis[name]) {
                survivors.push(name);
            }
        } catch {
            survivors.push(name);
        }
    }

    if (survivors.length > 0) {
        diag(`harness: could not remove global(s): ${survivors.join(", ")}`);
    }

    const stillThere = UNDELETABLE_GLOBALS.filter(name => name in globalThis);

    // A documentation note, not a runtime diagnostic: nothing about this run is
    // wrong, and the mitigation is the host's to apply. It is off by default
    // because the host attaches the tail of this stream to every plugin error,
    // and a paragraph of boilerplate in front of every real failure is worse
    // than no note at all. Set ROME_HARNESS_NOTES=1 to see it; the README
    // carries the same explanation.
    if (stillThere.length > 0 && tjs.env.ROME_HARNESS_NOTES) {
        diag(
            `harness: note -- ${stillThere.join(", ")} are engine-defined and non-configurable, so they stay reachable ` +
            "from plugin code. `tjs` in particular exposes the filesystem, subprocesses and `tjs.exit`; the host must " +
            "run this process with a memory limit and a wall-clock timeout, and treat its exit as a crash."
        );
    }
}

// ---------------------------------------------------------------------------
// plugin module
// ---------------------------------------------------------------------------

const argv = tjs.args;
const pluginArgument = argv.length >= 4 ? argv[argv.length - 1] : null;

if (!pluginArgument) {
    diag("harness: usage: tjs run harness.js <plugin.js>");
    tjs.exit(2);
}

const pluginPath = path.isAbsolute(pluginArgument)
    ? pluginArgument
    : path.resolve(tjs.cwd, pluginArgument);

let pluginModulePromise = null;

function loadPlugin() {
    if (pluginModulePromise === null) {
        pluginModulePromise = import(pluginPath).catch(err => {
            // Do not cache a failed load: a later request gets a fresh attempt
            // and a fresh error message.
            pluginModulePromise = null;
            throw err;
        });
    }

    return pluginModulePromise;
}

const VIEWS = new Set(["articles", "socialMedia", "pictures", "videos", "audios", "notifications"]);

// `item` is absent for every call except `preview`: it is the one method the
// host sends on behalf of a single entry rather than a whole source.
function makeCtx(params) {
    return {
        settings: (params.settings !== null && typeof params.settings === "object") ? params.settings : {},
        params: (params.params !== null && typeof params.params === "object") ? params.params : {},
        cursor: (params.cursor === undefined || params.cursor === null) ? null : String(params.cursor),
        item: (params.item !== null && typeof params.item === "object") ? params.item : null,
        fetch: hostFetch,
        storage,
        ui,
        log
    };
}

// ---------------------------------------------------------------------------
// host -> plugin methods
// ---------------------------------------------------------------------------

async function describe() {
    const mod = await loadPlugin();
    const meta = mod.meta;

    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
        throw new Error("plugin must export `meta` as an object");
    }

    if (typeof meta.id !== "string" || meta.id === "") {
        throw new Error("plugin `meta.id` must be a non-empty string");
    }

    if (meta.view !== undefined && !VIEWS.has(meta.view)) {
        throw new Error(`plugin \`meta.view\` must be one of: ${[...VIEWS].join(", ")}`);
    }

    // `settings` is always present, and null when the plugin declares none, so
    // the host can deserialize it into a plain Option.
    //
    // The exported hooks are reported rather than declared in `meta`: a plugin
    // that wrote the function has a preview, and asking its author to also say
    // so in the manifest is one more thing to forget.
    return {
        meta,
        settings: mod.settings === undefined ? null : mod.settings,
        hooks: { preview: typeof mod.preview === "function" }
    };
}

function validateEntry(entry, index) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`entries[${index}] must be an object`);
    }

    if (typeof entry.id !== "string" || entry.id === "") {
        throw new Error(
            `entries[${index}].id must be a non-empty string. The host deduplicates on it and an unstable id ` +
            "re-inserts the whole list on every refresh."
        );
    }

    if (entry.publishedAt instanceof Date) {
        entry.publishedAt = Math.floor(entry.publishedAt.getTime() / 1000);
    } else if (entry.publishedAt !== undefined && entry.publishedAt !== null && !Number.isFinite(Number(entry.publishedAt))) {
        throw new Error(`entries[${index}].publishedAt must be a number of unix seconds`);
    }
}

async function runFetch(params) {
    const mod = await loadPlugin();

    if (typeof mod.fetch !== "function") {
        throw new Error("plugin must export an async `fetch(ctx)` function");
    }

    const result = await mod.fetch(makeCtx(params));

    if (result === null || result === undefined || typeof result !== "object") {
        throw new Error("plugin `fetch` must return an object like { entries: [...] }");
    }

    if (!Array.isArray(result.entries)) {
        throw new Error("plugin `fetch` must return `entries` as an array");
    }

    result.entries.forEach(validateEntry);

    return {
        entries: result.entries,
        cursor: (result.cursor === undefined || result.cursor === null) ? null : String(result.cursor)
    };
}

/**
 * Draw one entry's page.
 *
 * Called when the reader opens an entry and the plugin exports the hook. The
 * item carries the values the plugin asked to be handed back — its `params` —
 * so a plugin that listed videos by id can ask its API about the video the
 * reader clicked, instead of the host stripping whatever HTML happens to be
 * behind the URL.
 *
 * `null` means "I have nothing to add", and the host keeps whatever the entry
 * already had.
 */
async function runPreview(params) {
    const mod = await loadPlugin();

    if (typeof mod.preview !== "function") {
        return null;
    }

    const ctx = makeCtx(params);

    if (ctx.item === null) {
        throw new Error("preview was called without an `item`");
    }

    const result = await mod.preview(ctx);

    if (result === null || result === undefined) {
        return null;
    }

    const content = typeof result === "string" ? result : result.content;

    if (typeof content !== "string") {
        throw new Error("plugin `preview` must return an HTML string, `{ content }`, or null");
    }

    return { content };
}

async function runLifecycle(name, params) {
    const mod = await loadPlugin();
    const hook = mod[name];

    if (typeof hook !== "function") {
        // Both hooks are optional.
        return null;
    }

    await hook(makeCtx(params));

    return null;
}

function invoke(request) {
    const params = (request.params !== null && typeof request.params === "object") ? request.params : {};

    switch (request.method) {
        case "describe": return describe();
        case "fetch": return runFetch(params);
        case "preview": return runPreview(params);
        case "activate": return runLifecycle("activate", params);
        case "deactivate": return runLifecycle("deactivate", params);
        default: return Promise.reject(new Error(`unknown method: ${request.method}`));
    }
}

// ---------------------------------------------------------------------------
// read loop
// ---------------------------------------------------------------------------

/** Handlers still running, so shutdown can wait for their responses. */
const inFlight = new Set();

function dispatch(request) {
    const id = request.id === undefined ? null : request.id;

    const task = Promise.resolve()
        .then(() => invoke(request))
        .then(
            result => writeMessage({ id, result: result === undefined ? null : result }),
            err => writeMessage({ id, error: { message: describeError(err) } })
        )
        .catch(err => diag("harness: failed to write a response: " + describeError(err)));

    inFlight.add(task);
    task.then(() => inFlight.delete(task), () => inFlight.delete(task));
}

/**
 * Called once stdin has closed. A host that has closed stdin will never answer
 * an outstanding request, so those calls are failed immediately -- which also
 * unblocks the handlers waiting on them, so shutdown does not have to wait for
 * anything but the handlers themselves.
 */
function abandonPendingHostCalls(reason) {
    shuttingDown = true;

    const entries = [...pendingHost.values()];

    pendingHost.clear();

    for (const entry of entries) {
        const err = new Error(reason);

        err.name = "HostError";
        entry.reject(err);
    }
}

function handleLine(line) {
    let message;

    try {
        message = JSON.parse(line);
    } catch (err) {
        diag(`harness: dropping malformed JSON line: ${describeError(err)}`);
        return;
    }

    if (message === null || typeof message !== "object" || Array.isArray(message)) {
        diag("harness: dropping non-object message");
        return;
    }

    // A request carries `method`; a response never does. That is what keeps the
    // two directions apart.
    if (typeof message.method === "string") {
        // Deliberately not awaited: the loop must stay free to read the replies
        // this handler is about to wait on.
        dispatch(message);
        return;
    }

    if (message.id === undefined) {
        diag("harness: dropping message with neither `method` nor `id`");
        return;
    }

    settleHostCall(message);
}

/** Backstop so a stuck handler cannot keep the process alive forever. */
const SHUTDOWN_GRACE_MS = 5000;

async function main() {
    const reader = tjs.stdin.getReader();
    let buffer = "";

    try {
        for (;;) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            let newline;

            while ((newline = buffer.indexOf("\n")) !== -1) {
                let line = buffer.slice(0, newline);

                buffer = buffer.slice(newline + 1);

                if (line.endsWith("\r")) {
                    line = line.slice(0, -1);
                }

                if (line.trim() === "") {
                    continue;
                }

                handleLine(line);
            }
        }
    } catch (err) {
        diag("harness: stdin read failed: " + describeError(err));
    }

    if (buffer.trim() !== "") {
        diag(`harness: discarding an unterminated final line (${buffer.length} bytes); requests are newline-delimited`);
    }

    // stdin closed. The host may simply have closed the pipe after sending its
    // last request rather than waiting for the reply, so drain the handlers
    // that are still running before leaving -- otherwise their responses would
    // be lost to the exit.
    abandonPendingHostCalls("the host closed the connection before replying");

    const running = [...inFlight];

    if (running.length > 0) {
        let grace = null;

        await Promise.race([
            Promise.allSettled(running),
            new Promise(resolve => {
                grace = setTimeout(resolve, SHUTDOWN_GRACE_MS);
            })
        ]);

        // A pending timer is an active handle: leaving it armed would keep the
        // process alive for the full grace period even though the handlers are
        // long done.
        if (grace !== null) {
            clearTimeout(grace);
        }
    }

    await stdoutChain;

    // Deliberately no `tjs.exit()` here. For a pipe, the stdout sink hands the
    // bytes to libuv and returns without waiting, so exiting now would truncate
    // any response larger than the pipe buffer -- exactly the big `fetch`
    // results. Closing the writer unrefs the handle instead, and the process
    // leaves on its own once libuv has drained the writes.
    try {
        await stdoutWriter.close();
    } catch {
        // Already closed, or the pipe is gone. Nothing left to do about it.
    }
}

hardenGlobals();
await main();
