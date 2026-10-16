// Assembles the ScratchJr web app into desktop/dist/ for the Tauri shell.
//
//   node desktop/assemble.mjs        (works from any cwd)
//
// Steps:
//   1. delete and recreate desktop/dist/
//   2. copy editions/free/src/** into it
//   3. replace the git-symlink placeholders (app.bundle.js / .map are checked out
//      as tiny text files on Windows) with the real bundle from src/build/bundles/
//      - app.bundle.js is copied over; the .map placeholder is removed (not shipped)
//
// No dependencies; Node >= 16.7 (fs.cpSync).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(desktopDir, '..');
const pageRoot = path.join(repoRoot, 'editions', 'free', 'src');
const bundle = path.join(repoRoot, 'src', 'build', 'bundles', 'app.bundle.js');
const dist = path.join(desktopDir, 'dist');

function fail (msg) {
    console.error(`assemble: ${msg}`);
    process.exit(1);
}

if (!fs.existsSync(path.join(pageRoot, 'index.html'))) {
    fail(`page root not found: ${pageRoot}`);
}
if (!fs.existsSync(bundle)) {
    fail(`bundle not found: ${bundle} (run "npm run build" / webpack at the repo root first)`);
}
const bundleSize = fs.statSync(bundle).size;
if (bundleSize < 100 * 1024) {
    fail(`bundle looks wrong (${bundleSize} bytes): ${bundle}`);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// dereference: if a real symlink exists (core.symlinks=true checkouts), copy its target content.
fs.cpSync(pageRoot, dist, { recursive: true, dereference: true });

fs.copyFileSync(bundle, path.join(dist, 'app.bundle.js'));
fs.rmSync(path.join(dist, 'app.bundle.js.map'), { force: true });

// Library: the open-source repo ships only placeholder art (Star, Farm). Add the
// openly licensed art in desktop/open-art/ (see its README):
//   svglibrary/  mascots (CC0)          characters/  Twemoji characters (CC BY 4.0)
//   backgrounds/ original scenes (CC0)  pnglibrary/  library thumbnails for all of them
const openArt = path.join(desktopDir, 'open-art');
const readList = (rel) => {
    const p = path.join(openArt, rel);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
};
const svgOut = path.join(dist, 'svglibrary');
for (const dir of ['svglibrary', 'characters', 'backgrounds']) {
    const from = path.join(openArt, dir);
    if (fs.existsSync(from)) {
        fs.cpSync(from, svgOut, { recursive: true, filter: (src) => !src.endsWith('.json') });
    }
}
if (fs.existsSync(path.join(openArt, 'pnglibrary'))) {
    fs.cpSync(path.join(openArt, 'pnglibrary'), path.join(dist, 'pnglibrary'), { recursive: true });
}

const mediaPath = path.join(dist, 'media.json');
const media = JSON.parse(fs.readFileSync(mediaPath, 'utf8'));
const strip = ({ source, ...entry }) => entry; // build-only fields
const mascots = readList('media-additions.json').sprites || [];
const characters = readList('characters/characters.json').map(strip);
const backgrounds = readList('backgrounds/backgrounds.json');
// The Twemoji Star replaces the open-source repo's Star.svg (same file name).
media.sprites = [...mascots, ...characters];
// New art with the same file name (e.g. Farm.svg) replaces the repo's placeholder.
media.backgrounds = [...backgrounds, ...media.backgrounds.filter((b) => !backgrounds.some((n) => n.md5 === b.md5))];
fs.writeFileSync(mediaPath, JSON.stringify(media, null, 4) + '\n');

// The library shows names from the locale files (CHARACTER_/BACKGROUND_<file>).
// Keep any existing translation; otherwise use the English name.
const locDir = path.join(dist, 'localizations');
for (const file of fs.readdirSync(locDir).filter((f) => f.endsWith('.json'))) {
    const p = path.join(locDir, file);
    const strings = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const s of media.sprites) {
        strings[`CHARACTER_${s.md5}`] ??= s.name;
    }
    for (const b of media.backgrounds) {
        strings[`BACKGROUND_${b.md5}`] ??= b.name;
    }
    fs.writeFileSync(p, JSON.stringify(strings, null, 4) + '\n');
}

const settingsPath = path.join(dist, 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
settings.defaultSprite = 'Tabby.svg';
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4) + '\n');

// Sanity check: no other symlink placeholders (tiny files whose content is a relative path) remain.
const suspicious = [];
(function walk (dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walk(p);
        } else if (/\.(js|css|html)$/.test(ent.name) && fs.statSync(p).size < 256) {
            const text = fs.readFileSync(p, 'utf8').trim();
            if (/^(\.\.\/)+[\w./-]+$/.test(text)) suspicious.push(path.relative(dist, p));
        }
    }
})(dist);
if (suspicious.length) {
    fail(`symlink placeholder(s) left in dist: ${suspicious.join(', ')}`);
}

let files = 0;
let bytes = 0;
(function count (dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) count(p);
        else { files++; bytes += fs.statSync(p).size; }
    }
})(dist);
console.log(`assemble: ${files} files, ${(bytes / 1048576).toFixed(1)} MB -> ${dist}`);
