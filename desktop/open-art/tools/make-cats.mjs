// Generates the CC0 cat characters in ../svglibrary/.
// Each shape gets explicit fill/stroke attributes (ScratchJr's paint editor does not
// inherit styles from groups) and coordinates are shifted so the viewBox starts at 0,0.
// Usage: node desktop/open-art/tools/make-cats.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'svglibrary');
fs.mkdirSync(out, {recursive: true});

const INK = '#2b2b33';
const base = {stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'};

// [tag, attrs]; attrs override the base stroke style. Coordinates are in the
// concept sheet's space; `box` is the character's bounding box in that space.
const cats = {
    Tabby: {
        name: 'Tabby',
        box: [50, 110, 160, 168],
        shapes: [
            ['path', {d: 'M150 250 q40 10 50 -30 q6 -30 -18 -26', fill: 'none', stroke: '#8d94a0', 'stroke-width': 9}],
            ['path', {d: 'M150 250 q40 10 50 -30 q6 -30 -18 -26', fill: 'none'}],
            ['ellipse', {cx: 115, cy: 200, rx: 58, ry: 62, fill: '#a9b0bc'}],
            ['path', {d: 'M78 165 l-8 -46 l34 22 z', fill: '#a9b0bc'}],
            ['path', {d: 'M152 165 l8 -46 l-34 22 z', fill: '#a9b0bc'}],
            ['path', {d: 'M80 148 l-3 -19 l14 9 z', fill: '#f2b6c4', 'stroke-width': 2}],
            ['path', {d: 'M150 148 l3 -19 l-14 9 z', fill: '#f2b6c4', 'stroke-width': 2}],
            ['path', {d: 'M95 150 l4 12 M115 146 v13 M135 150 l-4 12 M62 200 h14 M154 200 h14 M64 215 h12 M154 215 h12', fill: 'none', stroke: '#6f7684', 'stroke-width': 4}],
            ['ellipse', {cx: 98, cy: 190, rx: 9, ry: 12, fill: '#ffffff'}],
            ['ellipse', {cx: 132, cy: 190, rx: 9, ry: 12, fill: '#ffffff'}],
            ['circle', {cx: 100, cy: 193, r: 5, fill: INK, stroke: 'none'}],
            ['circle', {cx: 130, cy: 193, r: 5, fill: INK, stroke: 'none'}],
            ['path', {d: 'M111 206 h8 l-4 5 z', fill: '#e57a92', 'stroke-width': 2}],
            ['path', {d: 'M107 216 q8 7 16 0', fill: 'none', 'stroke-width': 2.5}],
            ['path', {d: 'M72 232 q43 16 86 0', fill: 'none', stroke: '#2bb3a4', 'stroke-width': 7}],
            ['circle', {cx: 115, cy: 243, r: 6, fill: '#ffd34d', 'stroke-width': 2}],
            ['ellipse', {cx: 88, cy: 262, rx: 16, ry: 8, fill: '#a9b0bc'}],
            ['ellipse', {cx: 142, cy: 262, rx: 16, ry: 8, fill: '#a9b0bc'}]
        ]
    },
    Plum: {
        name: 'Plum',
        box: [280, 72, 152, 196],
        shapes: [
            ['path', {d: 'M370 240 q60 0 52 -60 q-4 -24 -24 -14 q-14 8 -2 18', fill: 'none', stroke: '#9b6fd6', 'stroke-width': 10}],
            ['path', {d: 'M370 240 q60 0 52 -60 q-4 -24 -24 -14 q-14 8 -2 18', fill: 'none'}],
            ['path', {d: 'M310 265 q-6 -70 30 -80 q36 10 30 80 z', fill: '#9b6fd6'}],
            ['path', {d: 'M326 265 q0 -40 14 -46 q14 6 14 46 z', fill: '#e9dcfb', 'stroke-width': 2}],
            ['path', {d: 'M298 128 l-6 -52 l36 30 z', fill: '#9b6fd6'}],
            ['path', {d: 'M382 128 l6 -52 l-36 30 z', fill: '#9b6fd6'}],
            ['circle', {cx: 340, cy: 140, r: 50, fill: '#9b6fd6'}],
            ['circle', {cx: 321, cy: 136, r: 10, fill: '#ffffff'}],
            ['circle', {cx: 359, cy: 136, r: 10, fill: '#ffffff'}],
            ['circle', {cx: 323, cy: 138, r: 5, fill: INK, stroke: 'none'}],
            ['circle', {cx: 357, cy: 138, r: 5, fill: INK, stroke: 'none'}],
            ['circle', {cx: 310, cy: 158, r: 2, fill: '#f7c873', stroke: 'none'}],
            ['circle', {cx: 316, cy: 163, r: 2, fill: '#f7c873', stroke: 'none'}],
            ['circle', {cx: 364, cy: 163, r: 2, fill: '#f7c873', stroke: 'none'}],
            ['circle', {cx: 370, cy: 158, r: 2, fill: '#f7c873', stroke: 'none'}],
            ['circle', {cx: 340, cy: 155, r: 5, fill: '#ff8fab', 'stroke-width': 2}],
            ['path', {d: 'M330 166 q10 10 20 0', fill: 'none', 'stroke-width': 2.5}],
            ['path', {d: 'M284 150 l22 2 M284 162 l22 -2 M396 150 l-22 2 M396 162 l-22 -2', fill: 'none', 'stroke-width': 2}]
        ]
    },
    Nova: {
        name: 'Nova',
        box: [506, 72, 132, 206],
        shapes: [
            ['path', {d: 'M600 230 q34 -6 26 -48', fill: 'none', stroke: '#2f4b8c', 'stroke-width': 10}],
            ['path', {d: 'M600 230 q34 -6 26 -48', fill: 'none'}],
            ['circle', {cx: 626, cy: 178, r: 7, fill: '#ffd34d', 'stroke-width': 2}],
            ['rect', {x: 520, y: 185, width: 90, height: 70, rx: 30, fill: '#2f4b8c'}],
            ['path', {d: 'M565 200 l6 13 l14 1 l-11 9 l4 14 l-13 -8 l-13 8 l4 -14 l-11 -9 l14 -1 z', fill: '#ffffff', 'stroke-width': 2}],
            ['rect', {x: 516, y: 252, width: 40, height: 22, rx: 10, fill: '#e8553d'}],
            ['rect', {x: 574, y: 252, width: 40, height: 22, rx: 10, fill: '#e8553d'}],
            ['path', {d: 'M522 120 l2 -44 l30 28 z', fill: '#2f4b8c'}],
            ['path', {d: 'M608 120 l-2 -44 l-30 28 z', fill: '#2f4b8c'}],
            ['path', {d: 'M528 108 l1 -20 l13 12 z', fill: '#8fb3ff', 'stroke-width': 2}],
            ['path', {d: 'M602 108 l-1 -20 l-13 12 z', fill: '#8fb3ff', 'stroke-width': 2}],
            ['rect', {x: 510, y: 96, width: 110, height: 96, rx: 44, fill: '#2f4b8c'}],
            ['rect', {x: 540, y: 128, width: 20, height: 26, rx: 10, fill: '#ffffff'}],
            ['rect', {x: 570, y: 128, width: 20, height: 26, rx: 10, fill: '#ffffff'}],
            ['circle', {cx: 552, cy: 143, r: 6, fill: INK, stroke: 'none'}],
            ['circle', {cx: 578, cy: 143, r: 6, fill: INK, stroke: 'none'}],
            ['path', {d: 'M558 162 q7 6 14 0', fill: 'none', stroke: '#ffffff'}],
            ['circle', {cx: 565, cy: 160, r: 4, fill: '#ffd34d', 'stroke-width': 2}]
        ]
    }
};

// Shift absolute coordinates by (dx, dy). Path data here starts with an absolute
// M and otherwise uses relative commands, except for M/H/V which we shift too.
function shiftPath (d, dx, dy) {
    return d.replace(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g, (all, cmd, a, b) => {
        if (cmd === 'H') {
            return `H${+a + dx}`;
        }
        if (cmd === 'V') {
            return `V${+a + dy}`;
        }
        return `M${+a + dx} ${+b + dy}`;
    });
}

// ScratchJr's paint editor does not understand quadratic curves, so rewrite each
// relative `q x1 y1 x y` as the equivalent relative cubic `c`.
function quadToCubic (d) {
    return d.replace(/q\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/g, (all, a, b, c, e) => {
        const [x1, y1, x, y] = [a, b, c, e].map(Number);
        const r = (n) => Math.round(n * 1000) / 1000;
        return `c${r(x1 * 2 / 3)} ${r(y1 * 2 / 3)} ${r(x + (x1 - x) * 2 / 3)} ${r(y + (y1 - y) * 2 / 3)} ${x} ${y}`;
    });
}

function shift (tag, attrs, dx, dy) {
    const a = {...attrs};
    if (tag === 'path') {
        a.d = quadToCubic(shiftPath(a.d, dx, dy));
    }
    for (const k of ['cx', 'x']) {
        if (k in a) {
            a[k] += dx;
        }
    }
    for (const k of ['cy', 'y']) {
        if (k in a) {
            a[k] += dy;
        }
    }
    return a;
}

const meta = [];
for (const [file, cat] of Object.entries(cats)) {
    const [bx, by, w, h] = cat.box;
    const body = cat.shapes.map(([tag, attrs]) => {
        const a = {...base, ...shift(tag, attrs, -bx, -by)};
        if (a.stroke === 'none') {
            delete a['stroke-width'];
            delete a['stroke-linejoin'];
            delete a['stroke-linecap'];
        }
        const attrText = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
        return `<${tag} ${attrText}/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}px" height="${h}px" viewBox="0 0 ${w} ${h}">` +
        `<g id="${file}.svg">${body}</g></svg>\n`;
    fs.writeFileSync(path.join(out, `${file}.svg`), svg);
    meta.push({md5: `${file}.svg`, width: w, height: h, ext: 'svg', name: cat.name,
        order: 'characters,02 funky', tags: ['characters', '02 funky']});
}
fs.writeFileSync(path.join(out, '..', 'media-additions.json'), JSON.stringify({sprites: meta}, null, 4) + '\n');
console.log('wrote', meta.map((m) => m.md5).join(', '));
