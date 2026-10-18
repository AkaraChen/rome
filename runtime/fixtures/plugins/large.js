/**
 * Test fixture: a response far larger than a pipe buffer (~820 KB).
 *
 * This is what catches a harness that calls `tjs.exit()` while libuv still has
 * unwritten bytes queued -- the response would be cut off mid-JSON.
 */

export const meta = {
    id: "probe-large",
    name: "Large response",
    version: "1.0.0",
    apiVersion: 1,
    view: "articles"
};

export async function fetch() {
    const entries = [];

    for (let index = 0; index < 200; index++) {
        entries.push({
            id: `large:${index}`,
            title: `Entry ${index}`,
            content: "x".repeat(4096)
        });
    }

    return { entries };
}
