# Writing a Rome plugin

A Rome plugin is **one self-contained ES module** that turns something into a list of entries.
It can scrape a page that has no feed, call a JSON API, or compute a feed out of data that
already exists. Rome does no npm resolution: whatever your plugin needs, you bundle into the
single file yourself.

Plugins run inside a [txiki.js](https://github.com/saghul/txiki.js) child process (QuickJS-ng),
one process per plugin, and talk to the app over a small request/response protocol. You never
touch the UI, the database, or the filesystem: you get `fetch`, dialogs, your own key/value
store, and a log.

```
rome ──▶ tjs run runtime/harness.js /path/to/your-plugin.js
         │
         ├── your module: meta, settings, fetch, activate, deactivate
         └── ctx: { settings, params, cursor, fetch, storage, ui, log }
```

---

## The module

```js
export const meta = { ... };        // required
export const settings = { ... };    // optional
export async function fetch(ctx) {} // required
export async function activate(ctx) {}   // optional
export async function deactivate(ctx) {} // optional
```

### `meta` — required

```js
export const meta = {
    id: "hacker-news",          // required, stable, unique across all plugins
    name: "Hacker News",        // required, shown in the UI
    version: "1.0.0",           // required, your plugin's own version
    apiVersion: 1,              // required, the host interface you were written against
    view: "articles",           // required, one of the six below
    description: "…",           // optional, one line for the plugin list
    icon: "https://…"           // optional, absolute URL
};
```

`id` is what the host keys your plugin by. Changing it makes Rome see a different plugin.
Keep it lowercase, stable, and namespaced.

`view` is a closed set — it decides how entries are displayed, and it is the one thing about
your plugin the UI hard-codes:

| `view` | for |
| --- | --- |
| `articles` | text with a title, the default |
| `pictures` | image-first grids |
| `videos` | video entries |
| `audios` | audio entries |
| `socialMedia` | short posts from a timeline |
| `notifications` | things that happened, not things to read |

`apiVersion` is the interface version, not your plugin version. Declare the one you were
written against; the host refuses versions it does not provide, so an old plugin never breaks
silently when the interface moves.

### `fetch(ctx)` — required

Called every time Rome refreshes the source. Return `{ entries, cursor? }`.

```js
export async function fetch(ctx) {
    const response = await ctx.fetch("https://example.com/api/items");

    if (!response.ok) {
        throw new Error(`example.com returned ${response.status}`);
    }

    const items = await response.json();

    return {
        entries: items.map(item => ({
            id: `example:${item.uuid}`,   // see below — this must be stable
            title: item.name,
            url: item.html_url,
            author: item.owner.login,
            publishedAt: Math.floor(Date.parse(item.created_at) / 1000),
            summary: item.description
        }))
    };
}
```

Throwing is fine and expected. The error — message and stack — is shown against the source,
which is the only thing that makes a broken plugin fixable. Never swallow an error to return
an empty list: that hides the breakage and the source just looks empty forever.

### Lifecycle hooks — optional

`activate(ctx)` runs when the user enables the plugin or the source; `deactivate(ctx)` when
they disable it. Both may be async, and both may be omitted. They return nothing.

They are for setup that is not fetching: warming a cache, writing a first-run key to storage,
clearing timers. Do not fetch entries here — that is `fetch`'s job, and Rome decides when.

---

## The entry object

```js
{
    id: "example:4f2a1c",     // REQUIRED, string, stable — read the next section
    title: "A thing happened", // REQUIRED, string
    url: "https://…",          // optional, absolute URL
    author: "someone",         // optional
    publishedAt: 1717236000,   // optional, unix seconds (not milliseconds)
    content: "<p>…</p>",       // optional, the full body, HTML or text
    summary: "412 points · 87 comments", // optional, one line, shown in lists
    image: "https://…",        // optional, absolute URL
}
```

`publishedAt` is **unix seconds**. `Date.now() / 1000`, not `Date.now()`. A `Date` object is
accepted and converted for you, but a number is clearer. Entries without a `publishedAt` sort
by when Rome first saw them.

### `id` must be stable across runs

This is the one rule that will bite you.

Rome deduplicates on `id`. If `id` changes between two refreshes, Rome treats every entry as
new and **re-inserts the whole list**, every time — you get duplicates, the unread count
explodes, and anything the user starred is orphaned. It is the most common way to write a
plugin that looks like it works and is quietly destroying the user's data.

Use the identifier the *source* already has. Do not use array indices, do not use the current
time, do not use `Math.random()`, do not use the title, and do not use the entry's position on
the page.

```js
id: `hn:${itemId}`              // good — the site's own id, namespaced
id: `example:${item.uuid}`      // good
id: `example:${slug}`           // ok — if the slug is permanent
id: `example:${index}`          // BAD — reorders, so it re-inserts everything
id: `example:${Date.now()}`     // BAD — every refresh is "new"
id: `example:${item.title}`     // BAD — a retitled article is a duplicate
```

Namespace the id with your plugin or source name. Two plugins can easily produce the same
upstream id, and the host does not know they are different things.

The harness checks that `id` is a non-empty string and fails the fetch with a clear message if
it is missing. It cannot check that it is stable — that part is on you.

---

## `ctx`

Every call gets a fresh `ctx`.

| field | what it is |
| --- | --- |
| `ctx.settings` | the values the user set, keyed by your `settings` schema |
| `ctx.params` | this source's parameters — the same plugin can back many sources |
| `ctx.cursor` | the cursor from the previous `fetch`, or `null` on the first call |
| `ctx.fetch` | `fetch`, but through the host |
| `ctx.storage` | your plugin's key/value store |
| `ctx.ui` | dialogs, progress, opening a browser and the login window, plus `alert`/`confirm`/`prompt` as globals |
| `ctx.log` | `debug` / `info` / `warn` / `error`, and callable on its own |

### Plugin vs. source vs. entry

Worth getting right, because it decides where state lives:

- **Plugin** — your module. Installed once, shared by every source using it.
  `ctx.settings` and `ctx.storage` are at this level.
- **Source** — one instance of your plugin, with its own `ctx.params`. Subscribing to three
  subreddits with one plugin is three sources.
- **Entry** — one item, belonging to one source.

If your plugin needs per-source state, namespace the storage key yourself:

```js
const key = `lastSeen:${ctx.params.feed}`;
```

### `ctx.fetch(url, init)`

The same `fetch` you know, forwarded through the host. Use it for everything — it is how your
requests pick up the cookie jar (so logged-in sources work), the proxy, redirects, and the
per-plugin request log the user can inspect. No URL is blocked or rewritten; fetch whatever
you like.

```js
const response = await ctx.fetch("https://example.com/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ctx.settings.apiKey },
    body: JSON.stringify({ query: "…" })
});

response.ok            // true for 2xx
response.status        // 200
response.statusText    // "OK"
response.url           // the URL you asked for
response.headers.get("content-type")   // case-insensitive, null if absent
await response.text()  // the body as a string
await response.json()  // JSON.parse of the body
await response.arrayBuffer()
await response.clone()
```

The global `fetch` is the same function, so `fetch(...)` and `ctx.fetch(...)` are
interchangeable.

**Where this differs from the browser.** The host carries the body as a UTF-8 string, so:

- There is **no streaming** — the whole body is already in memory when you get it.
- `text()` and `json()` can be called **as many times as you like**; `bodyUsed` is always
  `false`. There is no one-shot stream to lose.
- Bodies must be a string, a `URLSearchParams`, or a plain object/array (which is sent as JSON
  with `content-type: application/json` if you did not set one). `ArrayBuffer`, `TypedArray`,
  `Blob` and `FormData` bodies throw — decode or serialise them yourself first.
- `init.signal` is ignored. The host owns request timeouts; aborting locally would not cancel
  anything, so pretending otherwise would be a lie.

A non-2xx response is **not** an error — you get a response with `ok === false`. Check it.

### `ctx.storage`

A per-plugin key/value store, backed by the host's database. Values are JSON.

```js
await ctx.storage.set("lastRun", Date.now());
const lastRun = await ctx.storage.get("lastRun");   // null if never set
```

There is no `delete` and no key listing. If you need to forget something, set it to `null`.

Use it for state that must survive a restart: a cursor the source does not give you, a token
you refreshed, a cache of something expensive. Do not use it as a cache for the entries
themselves — Rome already stores those.

`localStorage` and `sessionStorage` do not exist here (see *The runtime* below), on purpose:
there is exactly one storage story, and it is this one.

### `ctx.ui`

Rome owns the pixels. You get a closed set of semantic dialogs, so your plugin's setup looks
like the rest of the app.

```js
ctx.ui.alert("Saved.");
const ok = await ctx.ui.confirm("Delete the cached token?");
const token = await ctx.ui.prompt("API token", { title: "Example", placeholder: "sk-…", secret: true });
await ctx.ui.notify("Fetched 42 entries", "info");       // level: debug|info|warn|error
const values = await ctx.ui.form({ fields: [...] });     // null if cancelled
const picked = await ctx.ui.pick([{ id: "a", label: "A" }]);
const done = await ctx.ui.login("https://example.com/login");
ctx.ui.progress("Fetching 40 pages", 0.25);              // 0..1, or omit the value
ctx.ui.progress(null);                                   // take the bar down
const opened = await ctx.ui.openExternal("https://example.com/post");
```

`alert`, `confirm` and `prompt` are also **globals**, so the natural thing works:

```js
alert("This is a normal alert.");
```

**They are all async, and that is not a style choice.** A dialog is answered by the host over
the same stdin this runtime reads, and the runtime is single-threaded: blocking the thread to
wait for the reply would stop the read loop that delivers it, so a synchronous `confirm()`
could never return — it would deadlock the process, every time. The usual escape hatch is
closed too: txiki.js refuses to block the main thread at all, and `Atomics.wait` throws
`TypeError: cannot block in this thread`, so a worker plus a `SharedArrayBuffer` cannot stand
in for it either.

In practice: `alert()` is fire-and-forget in browsers too, so calling it without `await` is
fine. `await` `confirm()`, `prompt()`, `form()`, `pick()` and `login()` when you want their
result.

**Six of these wait for a person; three do not.** `notify`, `progress` and `openExternal` are
answered by Rome doing them, so they resolve immediately and they work anywhere — including
inside `fetch`, which is where the long jobs are. The other six need someone in front of the
window, so calling one from `fetch` fails with an error you can catch:

> a plugin cannot prompt here: this run has no window, and a refresh happens whether or not
> anyone is watching. Ask from `activate` instead.

### `ctx.ui.progress(message, value)`

For a job with a visible middle. `value` is `0`..`1`; omit it for a job whose size you do not
know yet, and the bar reads as *working* rather than as *0%*.

```js
export async function fetch(ctx) {
    ctx.ui.progress("Fetching pages");

    const pages = [];
    for (const [i, url] of urls.entries()) {
        pages.push(await (await ctx.fetch(url)).json());
        ctx.ui.progress("Fetching pages", (i + 1) / urls.length);
    }

    ctx.ui.progress(null);
    return { entries: pages.flatMap(toEntries) };
}
```

Each call replaces the last, so a hundred calls are one bar filling up rather than a hundred
toasts. **`progress(null)` is what takes it down, and nothing else does** — a bar that hid
itself on a timer would disappear under a job that is still running, which is exactly when the
reader is looking for it. Clear it on every path out of the loop, including the `catch`.

Values outside `0`..`1` are clamped rather than refused, so `(i + 1) / total` is always safe to
pass even when `total` is off by one.

### `ctx.ui.openExternal(url)`

Hand a URL to the reader's own browser. Resolves `true` if it was opened.

```js
await ctx.ui.openExternal(entry.url);
```

Only `http` and `https` open. Anything else — `file:`, `javascript:`, a custom scheme — is
refused and resolves `false`, because the URL came from your plugin rather than from the person
who would be clicking it. Check the result if the link might not be one of the two.

### `ctx.ui.login(url)`

A site that only lets you in through its own login page — a captcha, a second factor, an
OAuth redirect — cannot be asked for as a form. This opens a real browser window inside Rome,
lets the user sign in the way they normally would, and copies the cookies into the jar.

```js
export async function activate(ctx) {
    if (!ctx.settings.loggedIn) {
        if (!(await ctx.ui.login("https://example.com/login"))) return;   // closed
        await ctx.storage.set("loggedIn", true);
    }
}
```

Resolves `true` when the user presses **完成登录**, `false` when they close the window without
saying so. The cookies are already in the jar when it resolves, so a `fetch` in the same run is
authenticated — that ordering is the reason this is a host call and not "open a URL".

Call it from `activate`. A refresh has no window to put the login in, and the call fails there
with an error you can catch.

### `ctx.log`

Goes to the host's log for this plugin — never to stdout, which is the wire.

```js
ctx.log.debug("GET " + url);
ctx.log.info("fetched 42 entries");
ctx.log.warn("page 3 had no items");
ctx.log.error("parse failed");

ctx.log("shorthand for info");   // ctx.log is callable as well
```

`console.log`, `console.warn` and `console.error` are routed here too, so they are safe to
leave in — but `ctx.log` is the documented path.

---

## `settings` — declarative configuration

Your plugin declares which values it needs; Rome renders the settings page. This matters more
than it looks: **a broken plugin is exactly when the user needs to change its settings**, so
the settings page cannot depend on your code running.

```js
export const settings = {
    fields: [
        {
            key: "apiKey",              // the key it arrives under in ctx.settings
            type: "password",           // string|number|boolean|select|textarea|password
            label: "API token",
            description: "From your account page.",
            required: true,
            secret: true                // stored as a credential, masked in the UI
        },
        {
            key: "limit",
            type: "number",
            label: "Entries per page",
            default: 30,
            min: 1,
            max: 100
        },
        {
            key: "sort",
            type: "select",
            label: "Sort by",
            default: "hot",
            options: [
                { value: "hot", label: "Hot" },
                { value: "new", label: "New" }
            ]
        }
    ]
};
```

Read them defensively — a value can be missing on the very first run, before defaults are
written back:

```js
const limit = Number(ctx.settings.limit) || 30;
```

> This schema shape is the one part of the plugin interface that is not frozen. If the app's
> settings page disagrees with what you wrote, this section is what to check.

---

## The runtime

Your module is imported into a txiki.js realm after the harness has removed or replaced most
of the platform globals. This is not a security sandbox — Rome's trust model is that you audit
the plugin yourself — it is hygiene, so that a plugin cannot reach a capability by accident and
so that there is only one way to do each thing.

**Replaced** — these route through the host, which is the point:

| global | becomes |
| --- | --- |
| `fetch` | the host-backed fetch |
| `Response`, `Request`, `Headers` | matching shims |
| `console`, `print` | the host log |
| `alert`, `confirm`, `prompt` | host dialogs (async) |

**Removed** — each of these would either bypass the host or duplicate it:

| removed | why |
| --- | --- |
| `XMLHttpRequest`, `WebSocket`, `EventSource` | open their own connections: no cookie jar, no request log |
| `TCPSocket`, `TLSSocket`, `UDPSocket`, `PipeSocket` and the server variants | raw sockets, same problem |
| `Worker`, `BroadcastChannel` | a worker gets a fresh realm with its own globals, i.e. an escape from all of this |
| `WebAssembly` | reachable compute with no plugin use case — a plugin is one module, so a `.wasm` would have to be base64-embedded |
| `localStorage`, `sessionStorage` | per-process, so they lose data on restart; `ctx.storage` is the one storage story |

**Kept** — pure computation and data, with no way to reach outside:

`crypto` (WebCrypto — useful for signing APIs), `TextEncoder`/`TextDecoder`, `URL`,
`URLSearchParams`, `URLPattern`, `atob`/`btoa`, `structuredClone`, `Blob`, `File`, `FileReader`,
`FormData`, `CompressionStream`/`DecompressionStream`, `MessageChannel`/`MessagePort`,
`AbortController`/`AbortSignal`, `performance`, `setTimeout`/`setInterval` and friends.

**Reachable but out of contract:** `tjs` (the engine's own namespace — it exposes the
filesystem, subprocesses and `tjs.exit`), `navigator` and `self`. They are defined
non-configurable by the engine, so the harness cannot remove them. Do not use them: nothing
you build on them is part of the plugin interface, and reaching for `tjs.readFile` or
`tjs.exit` can hurt the user by accident. The host runs this process with a memory limit and a
wall-clock timeout and treats its exit as a crash, precisely because a plugin can do this.

There is no DOM and no `document`. A page that renders its content in JavaScript will hand you
an empty shell — that is a real limit of this design, not a bug you can work around.

---

## Worked example: Hacker News

The full file is at [`examples/hacker-news.js`](examples/hacker-news.js). It is a scraping
plugin — one request for the front page, parsed with regexes, because there is no DOM — and it
shows settings, per-source params, pagination with `ctx.cursor`, and logging.

```js
/**
 * Hacker News -- the worked example from runtime/README.md.
 *
 * It is a scraping plugin: one request for the front page, parsed with regexes
 * because the plugin runtime has no DOM. Copy it as a starting point, and read
 * the README for the parts it does not show (storage, dialogs, custom settings
 * forms).
 *
 * Drop it in Rome with: Settings -> Plugins -> Install -> this file.
 */

export const meta = {
    id: "hacker-news",
    name: "Hacker News",
    version: "1.0.0",
    apiVersion: 1,
    view: "articles",
    description: "The front page of Hacker News, plus New, Best and Ask.",
    icon: "https://news.ycombinator.com/favicon.ico"
};

export const settings = {
    fields: [
        {
            key: "limit",
            type: "number",
            label: "Entries per page",
            description: "How many stories to return in one fetch.",
            default: 30,
            min: 1,
            max: 100
        },
        {
            key: "minPoints",
            type: "number",
            label: "Minimum points",
            description: "Stories below this score are dropped. 0 keeps everything.",
            default: 0,
            min: 0
        }
    ]
};

const BASE = "https://news.ycombinator.com";

// `params.feed` picks the section; each Source using this plugin sets its own.
const FEEDS = {
    top: "/",
    new: "/newest",
    best: "/best",
    ask: "/ask"
};

// One <tr class='athing'> block, up to the start of the next one.
const ROW = /<tr class='athing[^']*' id='(\d+)'[\s\S]*?(?=<tr class='athing|<\/table>)/g;
const TITLE = /<span class="titleline"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
const SCORE = /<span class="score"[^>]*>([\d,]+)\s+points?<\/span>/;
const USER = /<a href="user\?id=([^"]+)" class="hnuser">/;
const AGE = /<span class="age"[^>]*title="([^"]*)"/;
const COMMENTS = /<a href="item\?id=\d+">([\d,]+)&nbsp;comments?<\/a>/;
const MORE = /<a href="([^"]+)" class="morelink"/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text) {
    return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
        if (entity[0] === "#") {
            const code = entity[1] === "x" || entity[1] === "X"
                ? Number.parseInt(entity.slice(2), 16)
                : Number.parseInt(entity.slice(1), 10);

            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }

        return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match;
    });
}

/**
 * HN mixes absolute links with relative ones like `item?id=123`, and an href in
 * HTML is entity-encoded (`?a=1&amp;b=2`), so decode before parsing.
 */
function absolute(href) {
    if (!href) {
        return null;
    }

    try {
        return new URL(decode(href), BASE + "/").href;
    } catch {
        return null;
    }
}

function plural(count, noun) {
    return `${count} ${noun}${Number(count) === 1 ? "" : "s"}`;
}

function integer(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, min), max);
}

function parseEntries(html, minPoints) {
    const entries = [];

    for (const row of html.matchAll(ROW)) {
        const itemId = row[1];
        const block = row[0];
        const title = TITLE.exec(block);

        if (!title) {
            continue;
        }

        const heading = decode(title[2].replace(/<[^>]*>/g, "")).trim();

        if (!heading) {
            continue;
        }

        const score = SCORE.exec(block);
        const points = score ? Number.parseInt(score[1].replace(/,/g, ""), 10) : 0;

        if (Number.isFinite(points) && points < minPoints) {
            continue;
        }

        const author = USER.exec(block);
        const age = AGE.exec(block);
        const comments = COMMENTS.exec(block);

        // `id` is what the host deduplicates on. The HN item id never changes,
        // so `hn:<item id>` is stable across runs -- which is the whole point.
        const entry = {
            id: `hn:${itemId}`,
            title: heading,
            url: absolute(title[1]) || `${BASE}/item?id=${itemId}`
        };

        if (author) {
            entry.author = decode(author[1]);
        }

        // The `title` attribute of the age span is an absolute UTC timestamp,
        // which is far more useful than the "3 hours ago" text.
        if (age && age[1]) {
            const stamp = age[1].endsWith("Z") ? age[1] : `${age[1]}Z`;
            const milliseconds = Date.parse(stamp);

            if (Number.isFinite(milliseconds)) {
                entry.publishedAt = Math.floor(milliseconds / 1000);
            }
        }

        const parts = [];

        if (points > 0) {
            parts.push(plural(points, "point"));
        }

        if (comments) {
            parts.push(plural(comments[1].replace(/,/g, ""), "comment"));
        }

        if (parts.length > 0) {
            entry.summary = parts.join(" · ");
        }

        entries.push(entry);
    }

    return entries;
}

export async function fetch(ctx) {
    const feed = Object.prototype.hasOwnProperty.call(FEEDS, ctx.params.feed) ? ctx.params.feed : "top";
    const limit = integer(ctx.settings.limit, 30, 1, 100);
    const minPoints = integer(ctx.settings.minPoints, 0, 0, Number.MAX_SAFE_INTEGER);

    // `ctx.cursor` is whatever this function returned last time. HN's own "More"
    // link is the cursor, so pagination is exactly what the site does.
    const url = ctx.cursor ? new URL(ctx.cursor, `${BASE}/`) : new URL(BASE + FEEDS[feed]);

    ctx.log.debug(`hacker-news: GET ${url.href}`);

    const response = await ctx.fetch(url, { headers: { accept: "text/html" } });

    if (!response.ok) {
        throw new Error(`Hacker News returned ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const entries = parseEntries(html, minPoints).slice(0, limit);
    const more = MORE.exec(html);

    return { entries, cursor: more ? decode(more[1]) : null };
}

export async function activate(ctx) {
    ctx.log.info(`hacker-news: activated (feed=${ctx.params.feed || "top"})`);
}

export async function deactivate() {
    // Nothing to clean up: this plugin holds no timers and no connections.
}
```

### Pagination

`fetch` returns a `cursor`, and Rome passes it back on the next call as `ctx.cursor`. Return
`null` (or omit it) when there is nothing more. The cursor is your own opaque string — Rome
never looks inside it, and it is stored, so keep it small.

The HN plugin uses the site's own "More" link as the cursor, which is the simplest correct
thing to do: it is exactly what a browser would follow.

### A note on `params`

`ctx.params` is how one plugin backs several sources — `{ feed: "new" }` and `{ feed: "best" }`
are two sources over one module. Where params come from is up to the host's UI; your job is to
read them defensively, as the HN plugin does with `ctx.params.feed`.

---

## Testing your plugin

You do not need the app. The harness speaks the protocol over stdin/stdout, so a fake host can
drive it, and one ships in this directory:

```sh
python3 runtime/fake-host.py <plugin.js> <scenario>
```

With no arguments it runs every scenario in its suite against its own fixture plugins. Point
it at your plugin to run one scenario against your file:

```sh
# what does `describe` return?
python3 runtime/fake-host.py describe ./my-plugin.js

# does fetch work end to end, with the host answering your http calls?
python3 runtime/fake-host.py fetch ./my-plugin.js
```

Or run the harness by hand and feed it a single request line — everything on stdout is the
protocol, everything on stderr is diagnostics:

```sh
printf '{"id":1,"method":"describe","params":{}}\n' \
    | tjs run runtime/harness.js ./my-plugin.js
```

> Note the `run`: `tjs <file>` only prints usage, and `tjs run harness.js plugin.js` is the
> form the app uses.

Two things the fake host cannot tell you: whether your `id`s are stable across real refreshes,
and whether your selectors still match the real site. Both are the reasons a plugin breaks.

### Debugging checklist

- **Nothing comes back.** Your `fetch` threw, or it never settled. The error response carries
  the message and the plugin stack.
- **Every refresh re-inserts everything.** Your `id` is not stable. See the section above.
- **Entries are empty but there is no error.** You returned `{ entries: [] }`. If the page
  should have had content, your selector stopped matching — throw instead of returning empty.
- **`response.ok` is false.** A 403 usually means the site wants a cookie the user has not
  given yet, or a `User-Agent`; a 404 means the URL is wrong.
