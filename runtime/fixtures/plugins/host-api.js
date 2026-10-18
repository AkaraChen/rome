/**
 * Test fixture: exercises storage, ui and the shape of the fetch shim.
 */

export const meta = {
    id: "probe-host-api",
    name: "Host API probe",
    version: "1.0.0",
    apiVersion: 1,
    view: "articles"
};

export async function fetch(ctx) {
    await ctx.storage.set("probe", { nested: [1, 2, 3] });

    const missingKey = await ctx.storage.get("nothing-here");

    const confirmed = await ctx.ui.confirm("Really?");
    const prompted = await ctx.ui.prompt("Secret?", { title: "T", placeholder: "p", secret: true });

    await ctx.ui.alert("hi");
    await ctx.ui.notify("done", "info");

    // Progress is a report, not a question: it resolves at once and the last
    // one replaces the one before it. The `null` at the end is what takes the
    // bar down, so a plugin that never sends it leaves one up for good.
    await ctx.ui.progress("fetching", 0.25);
    await ctx.ui.progress("fetching", 0.75);
    await ctx.ui.progress(null);

    const opened = await ctx.ui.openExternal("https://probe.test/read");
    const refused = await ctx.ui.openExternal("file:///etc/passwd");

    const jsonResponse = await ctx.fetch("https://probe.test/json");
    const teapot = await ctx.fetch("https://probe.test/teapot", { method: "POST", body: { a: 1 } });
    const missing = await ctx.fetch("https://probe.test/missing");

    return {
        entries: [{
            id: "probe:host-api",
            title: "host api",
            content: JSON.stringify({
                missingKey,
                json: await jsonResponse.json(),
                teapotOk: teapot.ok,
                teapotStatus: teapot.status,
                teapotText: teapot.statusText,
                contentType: jsonResponse.headers.get("CONTENT-TYPE"),
                missingOk: missing.ok,
                confirmed,
                prompted,
                opened,
                refused
            })
        }]
    };
}
