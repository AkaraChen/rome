#!/usr/bin/env node
// Put the upstream path on every ported plugin.
//
// Most of these files began as a route in RSSHub (AGPL-3.0) or a command in
// OpenCLI (Apache-2.0). The port rewrites them against Rome's protocol, but the
// path is still the first thing a reader needs when a site changes and the
// selector in the file no longer matches. It is also how the licence those
// ports came from stays visible.
//
// The OpenCLI side needs the checkout: a slug joins site and command with a
// dash, and `apple-podcasts-top` alone cannot say whether the dash belongs to
// the site or the command. The filesystem can.
//
// Idempotent: a file that already carries the right line is left alone, and a
// wrong line is corrected.
//
// Usage: node tools/provenance.mjs [opencli-checkout]

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIR = path.join(ROOT, 'plugins');
const OPENCLI = process.argv[2] ?? '/tmp/opencli-src';
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'rsshub-catalog.json'), 'utf8'));

/// Every `clis/<site>/<command>.js` in the checkout, keyed by the slug the
/// plugin would take: `<site>-<command>`. Longest site wins, so a namespace
/// that itself contains a dash is not read as a command.
const commands = new Map();

if (fs.existsSync(path.join(OPENCLI, 'clis'))) {
    for (const site of fs.readdirSync(path.join(OPENCLI, 'clis'))) {
        const dir = path.join(OPENCLI, 'clis', site);
        if (!fs.statSync(dir).isDirectory()) continue;

        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;

            const command = file.slice(0, -3);
            const slug = `${site}-${command}`;
            const previous = commands.get(slug);

            if (!previous || site.length > previous.site.length) {
                commands.set(slug, { site, command });
            }
        }
    }
}

function rsshubPath(slug) {
    const rest = slug.slice('rsshub-'.length);
    let match = null;

    for (const namespace of catalog) {
        if (!rest.startsWith(`${namespace.namespace}-`)) continue;
        if (match === null || namespace.namespace.length > match.namespace.namespace.length) {
            match = { namespace, route: rest.slice(namespace.namespace.length + 1) };
        }
    }

    if (!match) return null;

    // A nested route's slug joins its path segments with dashes, so
    // `sina/finance/china.ts` is reached as `sina-finance-china`.
    const route = match.namespace.routes.find(
        (candidate) => candidate.file.replace(/\.tsx?$/, '').replace(/\//g, '-') === match.route,
    );

    return route
        ? `lib/routes/${match.namespace.namespace}/${route.file}`
        : null;
}

function opencliPath(slug) {
    const found = commands.get(slug.slice('opencli-'.length));
    return found ? `clis/${found.site}/${found.command}.js` : null;
}

function headerFor(slug) {
    if (slug.startsWith('rsshub-')) {
        const upstream = rsshubPath(slug);
        return upstream ? `// Ported from RSSHub ${upstream} (AGPL-3.0).` : null;
    }

    if (slug.startsWith('opencli-')) {
        const upstream = opencliPath(slug);
        return upstream ? `// Ported from OpenCLI ${upstream} (Apache-2.0).` : null;
    }

    return null;
}

let touched = 0;
let unresolved = 0;

for (const name of fs.readdirSync(DIR).sort()) {
    if (!name.endsWith('.js')) continue;

    const file = path.join(DIR, name);
    const source = fs.readFileSync(file, 'utf8');
    const slug = name.slice(0, -3);
    const header = headerFor(slug);

    if (header === null) {
        if (slug.startsWith('rsshub-') || slug.startsWith('opencli-')) unresolved++;
        continue;
    }

    // An existing provenance line is replaced rather than duplicated: a first
    // pass that guessed the OpenCLI split may have got it wrong.
    const lines = source.split('\n');
    const existing = lines.findIndex((line) => /^\/\/ Ported from (RSSHub|OpenCLI) /.test(line));

    if (existing === 0) {
        if (lines[0] === header) continue;
        lines[0] = header;
        fs.writeFileSync(file, lines.join('\n'));
    } else if (existing > 0) {
        lines.splice(existing, 1);
        lines.unshift(header);
        fs.writeFileSync(file, lines.join('\n'));
    } else {
        fs.writeFileSync(file, `${header}\n${source}`);
    }

    touched++;
}

console.log(`added or corrected a provenance line on ${touched} plugin${touched === 1 ? '' : 's'}`);
if (unresolved > 0) {
    console.log(`${unresolved} ported plugin${unresolved === 1 ? '' : 's'} has no upstream path in the catalog`);
}
