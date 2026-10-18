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
