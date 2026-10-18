/**
 * Test fixture: `meta` exists but has no usable `id`, and `view` is not in the
 * closed set. `describe` must fail loudly rather than hand the host something
 * it cannot key or render.
 */

export const meta = {
    name: "No id, bad view",
    version: "1.0.0",
    apiVersion: 1,
    view: "podcasts"
};

export async function fetch() {
    return { entries: [] };
}
