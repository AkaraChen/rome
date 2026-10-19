#!/usr/bin/env node
// Build a catalogue of RSSHub namespaces and routes.
//
// The point is not to understand TypeScript. It is to know which namespaces
// exist, how many routes each one publishes, which routes need a browser, and
// which ones read HTML rather than an API — the things that decide whether a
// port is a small JSON mapping or a scraper.
//
// Usage: node tools/rsshub-catalog.mjs <rsshub-checkout> [out.json]

import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const out = process.argv[3] ?? 'tools/rsshub-catalog.json';

if (!root) {
    console.error('usage: node tools/rsshub-catalog.mjs <rsshub-checkout> [out.json]');
    process.exit(2);
}

const routesDir = path.join(root, 'lib', 'routes');

function field(text, key) {
    const match = text.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`$]*)\\1`));
    return match ? match[2] : null;
}

function boolField(text, key) {
    return new RegExp(`\\b${key}\\s*:\\s*true\\b`).test(text);
}

/** The text inside `key: { ... }`, brace-balanced. */
function block(text, key) {
    const start = text.search(new RegExp(`\\b${key}\\s*:\\s*\\{`));
    if (start < 0) return '';

    let i = text.indexOf('{', start);
    let depth = 0;
    let quote = null;

    for (let j = i; j < text.length; j++) {
        const c = text[j];

        if (quote) {
            if (c === '\\') j++;
            else if (c === quote) quote = null;
            continue;
        }

        if (c === "'" || c === '"' || c === '`') quote = c;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return text.slice(i + 1, j);
    }

    return '';
}

/** Top-level keys of an object body, e.g. the parameter names. */
function keys(body) {
    const found = [];
    let depth = 0;
    let quote = null;

    for (let i = 0; i < body.length; i++) {
        const c = body[i];

        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            continue;
        }

        if (c === "'" || c === '"' || c === '`') {
            quote = c;
            continue;
        }

        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') depth--;
        else if (depth === 0) {
            const match = body.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/);
            if (match) {
                found.push(match[1]);
                i += match[0].length - 1;
            }
        }
    }

    return found;
}

const namespaces = [];

/// Every route file under `dir`, as paths relative to it.
///
/// Namespaces nest: `sina/finance/china.ts` is a route of the `sina`
/// namespace, and its plugin slug joins the segments with dashes. One level of
/// readdir would miss every such route.
function routeFiles(dir, prefix = '') {
    const found = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
            found.push(...routeFiles(path.join(dir, entry.name), relative));
            continue;
        }

        // `.tsx` routes exist and are ordinary routes: `notion/site.tsx` and
        // `xueqiu/stock-comments.tsx` are both served without a browser.
        if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
        if (entry.name === 'namespace.ts') continue;

        found.push(relative);
    }

    return found;
}

for (const entry of fs.readdirSync(routesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(routesDir, entry.name);
    const namespaceFile = path.join(dir, 'namespace.ts');
    const namespaceText = fs.existsSync(namespaceFile) ? fs.readFileSync(namespaceFile, 'utf8') : '';
    const routes = [];

    for (const file of routeFiles(dir)) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        if (!/export\s+const\s+route\s*:\s*Route\s*=/.test(text)) continue;

        routes.push({
            file,
            path: field(text, 'path'),
            name: field(text, 'name'),
            example: field(text, 'example'),
            view: field(text, 'view'),
            requiresPuppeteer: boolField(text, 'requirePuppeteer'),
            antiCrawler: boolField(text, 'antiCrawler'),
            requiresConfig: boolField(text, 'requireConfig'),
            parameters: keys(block(text, 'parameters')),
            usesCheerio: /\b(cheerio|load\s*\()/.test(text),
            usesJson: /\b(response\.json|resp\.data|\.data\b|ofetch|got\s*\()/.test(text),
            usesRss: /rss|atom|feedparser|parseFeed/i.test(text),
        });
    }

    if (routes.length === 0) continue;

    namespaces.push({
        namespace: entry.name,
        name: field(namespaceText, 'name') ?? entry.name,
        url: field(namespaceText, 'url'),
        routes,
    });
}

namespaces.sort((a, b) => b.routes.length - a.routes.length || a.namespace.localeCompare(b.namespace));

fs.writeFileSync(out, JSON.stringify(namespaces, null, 2));

const routeCount = namespaces.reduce((sum, ns) => sum + ns.routes.length, 0);
const simple = namespaces.reduce(
    (sum, ns) => sum + ns.routes.filter((r) => !r.requiresPuppeteer && !r.antiCrawler).length,
    0,
);

console.log(`${namespaces.length} namespaces, ${routeCount} routes (${simple} without a browser)`);
console.log(`wrote ${out}`);
