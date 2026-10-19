#!/usr/bin/env node
// Validate every bundled plugin's manifest, and generate the Rust table.
//
// The market draws its cards from `src/bundled.rs`, which has to know an id,
// name, description, icon and view before a plugin has ever run. That table is
// generated from the manifests here so that adding a plugin is one file, not
// one file plus a Rust edit.
//
// Usage:
//   node tools/plugins.mjs check [file.js ...]
//   node tools/plugins.mjs generate
//   node tools/plugins.mjs list

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PLUGIN_DIR = path.join(ROOT, 'plugins');
const GENERATED = path.join(ROOT, 'src', 'bundled', 'generated.rs');

const VIEWS = new Set(['articles', 'pictures', 'videos', 'audios', 'socialMedia']);
const RUST_VIEW = {
    articles: 'Articles',
    pictures: 'Pictures',
    videos: 'Videos',
    audios: 'Audios',
    socialMedia: 'SocialMedia',
};
const FIELD_TYPES = new Set(['text', 'password', 'number', 'textarea', 'checkbox', 'select']);

const problems = [];

function fail(file, message) {
    problems.push(`${path.relative(ROOT, file)}: ${message}`);
}

function pluginFiles() {
    return fs
        .readdirSync(PLUGIN_DIR)
        .filter((name) => name.endsWith('.js'))
        .sort()
        .map((name) => path.join(PLUGIN_DIR, name));
}

async function load(file) {
    const url = `${pathToFileURL(file).href}?mtime=${fs.statSync(file).mtimeMs}`;
    return import(url);
}

function checkLiteral(source, file, key, value) {
    if (!source.includes(`${key}: '${value}'`)) {
        fail(file, `manifest must contain ${key}: '${value}'`);
    }
}

function checkUrl(file, field, value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        fail(file, `${field} is not an absolute URL: ${value}`);
        return;
    }
    if (url.protocol !== 'https:') fail(file, `${field} must be https: ${value}`);
}

function checkFields(file, where, schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        fail(file, `${where} must be an object with a fields array`);
        return;
    }

    if (!Array.isArray(schema.fields)) {
        fail(file, `${where}.fields must be an array`);
        return;
    }

    const seen = new Set();

    for (const [index, field] of schema.fields.entries()) {
        const at = `${where}.fields[${index}]`;

        if (!field || typeof field !== 'object' || Array.isArray(field)) {
            fail(file, `${at} must be an object`);
            continue;
        }

        // A source parameter is a JSON key, not a Rust or JavaScript
        // identifier: an upstream argument named `year-from` is reachable as
        // `ctx.params['year-from']` and should keep its name.
        if (typeof field.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(field.key)) {
            fail(file, `${at}.key must be a plain parameter name`);
            continue;
        }

        if (seen.has(field.key)) fail(file, `${at}.key is declared twice: ${field.key}`);
        seen.add(field.key);

        if (field.label !== undefined && (typeof field.label !== 'string' || !field.label.trim())) {
            fail(file, `${at}.label must be a non-empty string`);
        }

        if (field.type !== undefined && !FIELD_TYPES.has(field.type)) {
            fail(file, `${at}.type is not one of ${[...FIELD_TYPES].join(', ')}: ${field.type}`);
        }

        if (field.type === 'select') {
            if (!Array.isArray(field.options) || field.options.length === 0) {
                fail(file, `${at}.options must be a non-empty array for a select`);
            } else {
                for (const option of field.options) {
                    if (typeof option === 'string') continue;
                    if (!option || typeof option !== 'object' || typeof option.value !== 'string') {
                        fail(file, `${at}.options entries must be strings or { value, label }`);
                    }
                }
            }
        }
    }
}

async function inspect(file) {
    const source = fs.readFileSync(file, 'utf8');
    const slug = path.basename(file, '.js');
    const expectedId = `rome.${slug}`;

    if (/^\s*import\s/m.test(source)) {
        fail(file, 'plugin files must be self-contained; no import statements');
    }
    if (/\brequire\s*\(/.test(source)) {
        fail(file, 'plugin files must be self-contained; no require()');
    }

    let module;
    try {
        module = await load(file);
    } catch (error) {
        fail(file, `cannot import plugin: ${error.message}`);
        return null;
    }

    const meta = module.meta;

    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        fail(file, 'must export `meta` as an object');
        return null;
    }

    if (meta.id !== expectedId) {
        fail(file, `meta.id must be '${expectedId}' (the file name decides the id)`);
    }
    checkLiteral(source, file, 'id', expectedId);

    if (typeof meta.name !== 'string' || !meta.name.trim()) {
        fail(file, 'meta.name must be a non-empty string');
    } else {
        if (/['"\\\r\n]/.test(meta.name)) {
            fail(file, 'meta.name must not contain quotes, backslashes or newlines');
        }
        checkLiteral(source, file, 'name', meta.name);
    }

    if (typeof meta.description !== 'string' || !meta.description.trim()) {
        fail(file, 'meta.description must be a non-empty string');
    } else {
        if (/['"\\\r\n]/.test(meta.description)) {
            fail(file, 'meta.description must not contain quotes, backslashes or newlines');
        }
        checkLiteral(source, file, 'description', meta.description);
    }

    if (meta.apiVersion !== '1' && meta.apiVersion !== 1) {
        fail(file, "meta.apiVersion must be '1'");
    }
    if (!source.includes("apiVersion: '1'") && !source.includes('apiVersion: 1')) {
        fail(file, "write apiVersion as '1'");
    }

    if (meta.view !== undefined) {
        if (!VIEWS.has(meta.view)) {
            fail(file, `meta.view is not one of ${[...VIEWS].join(', ')}: ${meta.view}`);
        } else {
            checkLiteral(source, file, 'view', meta.view);
        }
    }

    if (meta.icon !== undefined) {
        if (typeof meta.icon !== 'string') {
            fail(file, 'meta.icon must be a string');
        } else {
            checkUrl(file, 'meta.icon', meta.icon);
            checkLiteral(source, file, 'icon', meta.icon);
        }
    }

    if (meta.params !== undefined) checkFields(file, 'meta.params', meta.params);
    if (module.settings !== undefined && module.settings !== null) {
        checkFields(file, 'settings', module.settings);
    }

    if (typeof module.fetch !== 'function') {
        fail(file, 'must export a `fetch(ctx)` function');
    }

    return {
        slug,
        plugin_id: expectedId,
        name: meta.name,
        description: meta.description,
        icon: meta.icon ?? null,
        view: meta.view ?? 'articles',
    };
}

function rustString(value) {
    if (/[\u0000-\u001f]/.test(value)) {
        throw new Error(`control character in ${JSON.stringify(value)}`);
    }
    return JSON.stringify(value);
}

async function generate(plugins) {
    const rows = plugins
        .slice()
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((plugin) => {
            const icon = plugin.icon === null ? 'None' : `Some(${rustString(plugin.icon)})`;
            return `    Bundled {
        slug: ${rustString(plugin.slug)},
        plugin_id: ${rustString(plugin.plugin_id)},
        name: ${rustString(plugin.name)},
        description: ${rustString(plugin.description)},
        icon: ${icon},
        view: crate::models::View::${RUST_VIEW[plugin.view]},
        code: include_str!("../../plugins/${plugin.slug}.js"),
    },`;
        });

    const source = `// @generated by tools/plugins.mjs -- do not edit by hand.
//
// One row per \`plugins/*.js\`, sorted by slug. Regenerate with:
//
//     node tools/plugins.mjs generate

use super::Bundled;

pub const ALL: &[Bundled] = &[
${rows.join('\n')}
];
`;

    fs.mkdirSync(path.dirname(GENERATED), { recursive: true });
    fs.writeFileSync(GENERATED, source);
    console.log(`wrote ${path.relative(ROOT, GENERATED)} (${plugins.length} plugins)`);
}

const command = process.argv[2] ?? 'check';
const explicit = process.argv.slice(3);
const files = explicit.length ? explicit.map((file) => path.resolve(file)) : pluginFiles();
const plugins = [];

for (const file of files) {
    const plugin = await inspect(file);
    if (plugin) plugins.push(plugin);
}

if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'}`);
    process.exit(1);
}

if (command === 'generate') {
    await generate(plugins);
} else if (command === 'list') {
    for (const plugin of plugins) console.log(`${plugin.slug}\t${plugin.name}\t${plugin.view}`);
} else if (command !== 'check') {
    console.error(`unknown command: ${command}`);
    process.exit(2);
} else {
    console.log(`✓ ${plugins.length} plugin${plugins.length === 1 ? '' : 's'}`);
}
