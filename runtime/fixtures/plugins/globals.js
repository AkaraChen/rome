/**
 * Test fixture: reports what the plugin realm can actually reach.
 *
 * The report travels back as the `content` of a single entry, because `fetch`
 * may only return `{ entries, cursor }`.
 */

export const meta = {
    id: "probe-globals",
    name: "Global probe",
    version: "1.0.0",
    apiVersion: 1,
    view: "articles"
};

const PROBED = [
    "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebSocketError", "EventSource",
    "TCPSocket", "TLSSocket", "UDPSocket", "PipeSocket",
    "TCPServerSocket", "TLSServerSocket", "PipeServerSocket",
    "Worker", "BroadcastChannel", "WebAssembly", "localStorage", "sessionStorage",
    "tjs", "navigator", "self",
    "crypto", "URL", "URLSearchParams", "URLPattern", "structuredClone", "TextDecoder", "TextEncoder",
    "Blob", "File", "FormData", "MessageChannel", "MessagePort", "performance",
    "atob", "btoa", "fetch", "Response", "Request", "Headers", "console",
    "alert", "confirm", "prompt", "print", "setTimeout", "queueMicrotask", "AbortController"
];

export async function fetch(ctx) {
    // Both of these would corrupt the wire if they wrote to stdout.
    console.log("console-probe");
    print("print-probe");

    const report = {
        present: PROBED.filter(name => name in globalThis),
        fetchIsHostShim: globalThis.fetch === ctx.fetch,
        responseName: globalThis.Response ? globalThis.Response.name : null,
        requestName: globalThis.Request ? globalThis.Request.name : null,
        headersName: globalThis.Headers ? globalThis.Headers.name : null,
        uiGlobals: {
            alert: typeof alert === "function",
            confirm: typeof confirm === "function",
            prompt: typeof prompt === "function"
        }
    };

    return {
        entries: [{ id: "probe:globals", title: "globals", content: JSON.stringify(report) }]
    };
}
