/**
 * Test fixture: the corners of the fetch shim.
 *
 * Every case reports either `{ok: true, value}` or `{ok: false, error}`, so the
 * fake host can assert on behaviour that should throw as well as behaviour that
 * should work.
 */

export const meta = {
    id: "probe-fetch-edges",
    name: "Fetch edges",
    version: "1.0.0",
    apiVersion: 1,
    view: "articles"
};

async function attempt(run) {
    try {
        return { ok: true, value: await run() };
    } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }
}

export async function fetch(ctx) {
    const cases = {
        plainString: async () => {
            const response = await ctx.fetch("https://probe.test/json");

            return { status: response.status, statusText: response.statusText, url: response.url };
        },

        typedArrayBody: () => ctx.fetch("https://probe.test/json", { method: "POST", body: new Uint8Array([1, 2, 3]) }),

        getWithBody: () => ctx.fetch("https://probe.test/json", { method: "GET", body: "nope" }),

        missingUrl: () => ctx.fetch(),

        requestObject: async () => {
            const request = new Request("https://probe.test/json", { method: "post" });
            const response = await ctx.fetch(request);

            return { method: request.method, status: response.status };
        },

        urlObject: async () => (await ctx.fetch(new URL("https://probe.test/json"))).status,

        headersInit: () => ctx.fetch("https://probe.test/json", { headers: new Headers({ "X-Test": "1" }) }),

        searchParamsBody: () => ctx.fetch("https://probe.test/json", { method: "POST", body: new URLSearchParams({ a: "1" }) }),

        objectBody: () => ctx.fetch("https://probe.test/json", { method: "POST", body: { a: 1 } }),

        serverError: async () => {
            const response = await ctx.fetch("https://probe.test/boom");

            return { ok: response.ok, status: response.status, text: await response.text() };
        },

        bodyIsReusable: async () => {
            const response = await ctx.fetch("https://probe.test/json");

            return { first: await response.text(), second: await response.text(), bodyUsed: response.bodyUsed };
        },

        clone: async () => {
            const response = await ctx.fetch("https://probe.test/json");
            const copy = response.clone();

            return { original: await response.json(), copied: await copy.json() };
        },

        constructResponse: async () => {
            const response = new Response("hi", { status: 201, headers: { "x-a": "b" } });

            return {
                ok: response.ok,
                status: response.status,
                header: response.headers.get("X-A"),
                text: await response.text()
            };
        }
    };

    const report = {};

    for (const name of Object.keys(cases)) {
        report[name] = await attempt(cases[name]);
    }

    return {
        entries: [{ id: "probe:fetch-edges", title: "fetch edges", content: JSON.stringify(report) }]
    };
}
