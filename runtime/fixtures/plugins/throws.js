/**
 * Test fixture: a plugin whose `fetch` throws. The harness must turn this into
 * an `error` response carrying the stack, not a hang and not an exit.
 */

export const meta = {
    id: "probe-throws",
    name: "Throws",
    version: "1.0.0",
    apiVersion: 1,
    view: "articles"
};

export async function fetch(ctx) {
    ctx.log.info("about to throw");

    throw new Error("boom from the plugin");
}
