// Generates the CC0 "Scribble Jr" brand art: wordmark, lobby logo, start-screen
// mascots, credits text and the app icon source.
//
// Art rules (keep these so the files render crisply as CSS backgrounds and in the
// app's own SVG handling): only <path>/<circle>/<ellipse>/<rect> inside a single
// wrapping <g>, explicit fill/stroke on every shape, no transforms/gradients/
// filters/defs/use/text/image, and path data uses absolute M/L/C/Z only.
// (creditsText.svg is the one exception: it is plain <text> credits.)
//
// Usage: node desktop/open-art/tools/make-brand.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const openArt = path.resolve(here, '..');
const desktop = path.resolve(openArt, '..');
const repo = path.resolve(desktop, '..');
const src = path.join(repo, 'editions', 'free', 'src', 'assets');
const brandDir = path.join(openArt, 'brand');
fs.mkdirSync(brandDir, {recursive: true});

const INK = '#2b2b33';
const r2 = (n) => {
    const v = Math.round(n * 100) / 100;
    return Object.is(v, -0) ? 0 : v;
};

// ---------------------------------------------------------------------------
// Geometry. A path is a list of segments: ['M', x, y] | ['L', x, y] |
// ['C', x1, y1, x2, y2, x, y] | ['Z'].
// ---------------------------------------------------------------------------
class P {
    constructor () {
        this.segs = [];
        this.cur = null;
    }
    M (x, y) {
        this.segs.push(['M', x, y]);
        this.cur = [x, y];
        return this;
    }
    L (x, y) {
        this.segs.push(['L', x, y]);
        this.cur = [x, y];
        return this;
    }
    C (x1, y1, x2, y2, x, y) {
        this.segs.push(['C', x1, y1, x2, y2, x, y]);
        this.cur = [x, y];
        return this;
    }
    Z () {
        this.segs.push(['Z']);
        return this;
    }
    // Elliptical arc around (cx, cy) from angle a0 to a1 (degrees, y-down so
    // positive angles turn clockwise on screen), as cubic segments.
    arc (cx, cy, rx, ry, a0, a1) {
        const pt = (t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
        const dv = (t) => [-rx * Math.sin(t), ry * Math.cos(t)];
        const t0 = a0 * Math.PI / 180;
        const t1 = a1 * Math.PI / 180;
        const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 2)));
        const start = pt(t0);
        if (this.cur) {
            this.L(start[0], start[1]);
        } else {
            this.M(start[0], start[1]);
        }
        for (let i = 0; i < n; i++) {
            const ta = t0 + (t1 - t0) * i / n;
            const tb = t0 + (t1 - t0) * (i + 1) / n;
            const k = 4 / 3 * Math.tan((tb - ta) / 4);
            const [pa, da, pb, db] = [pt(ta), dv(ta), pt(tb), dv(tb)];
            this.C(pa[0] + k * da[0], pa[1] + k * da[1], pb[0] - k * db[0], pb[1] - k * db[1], pb[0], pb[1]);
        }
        return this;
    }
}

const path$ = (fn) => {
    const p = new P();
    fn(p);
    return p.segs;
};

// Affine map: rotate by `deg` about (ox, oy), then scale by s, then translate.
function mapper ({s = 1, tx = 0, ty = 0, deg = 0, ox = 0, oy = 0} = {}) {
    const a = deg * Math.PI / 180;
    const [c, si] = [Math.cos(a), Math.sin(a)];
    return (x, y) => {
        const dx = x - ox;
        const dy = y - oy;
        const rx = ox + dx * c - dy * si;
        const ry = oy + dx * si + dy * c;
        return [rx * s + tx, ry * s + ty];
    };
}

function mapSegs (segs, m) {
    return segs.map((sg) => {
        if (sg[0] === 'Z') {
            return ['Z'];
        }
        const out = [sg[0]];
        for (let i = 1; i < sg.length; i += 2) {
            out.push(...m(sg[i], sg[i + 1]));
        }
        return out;
    });
}

const segsToD = (segs) => segs.map((sg) => sg[0] + (sg.length > 1 ? sg.slice(1).map(r2).join(' ') : '')).join(' ');

// Shapes: {tag, ...geometry, fill, stroke, sw}. `transformShape` applies a
// uniform scale/translate (and rotation for paths and circles only).
function transformShape (sh, opts) {
    const m = mapper(opts);
    const s = opts.s || 1;
    const o = {...sh};
    if ('sw' in o) {
        o.sw = o.sw * s;
    }
    switch (sh.tag) {
    case 'path':
        o.segs = mapSegs(sh.segs, m);
        break;
    case 'circle':
        [o.cx, o.cy] = m(sh.cx, sh.cy);
        o.r = sh.r * s;
        break;
    case 'ellipse':
        [o.cx, o.cy] = m(sh.cx, sh.cy);
        o.rx = sh.rx * s;
        o.ry = sh.ry * s;
        break;
    case 'rect':
        [o.x, o.y] = m(sh.x, sh.y);
        o.width = sh.width * s;
        o.height = sh.height * s;
        if ('rx' in sh) {
            o.rx = sh.rx * s;
        }
        break;
    }
    return o;
}

function shapeToSvg (sh) {
    const geo = {
        path: () => `d="${segsToD(sh.segs)}"`,
        circle: () => `cx="${r2(sh.cx)}" cy="${r2(sh.cy)}" r="${r2(sh.r)}"`,
        ellipse: () => `cx="${r2(sh.cx)}" cy="${r2(sh.cy)}" rx="${r2(sh.rx)}" ry="${r2(sh.ry)}"`,
        rect: () => `x="${r2(sh.x)}" y="${r2(sh.y)}" width="${r2(sh.width)}" height="${r2(sh.height)}"` +
            (sh.rx ? ` rx="${r2(sh.rx)}" ry="${r2(sh.rx)}"` : '')
    }[sh.tag]();
    const stroke = sh.stroke || 'none';
    let st = `stroke="${stroke}"`;
    if (stroke !== 'none') {
        st += ` stroke-width="${r2(sh.sw ?? 3)}" stroke-linejoin="round" stroke-linecap="round"`;
    }
    return `<${sh.tag} ${geo} fill="${sh.fill || 'none'}" ${st}/>`;
}

function svgDoc (id, w, h, shapes) {
    return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}px" height="${h}px" viewBox="0 0 ${w} ${h}">` +
        `<g id="${id}">${shapes.map(shapeToSvg).join('')}</g></svg>\n`;
}

// Shorthand shape constructors.
const pth = (segs, fill, stroke = INK, sw = 3) => ({tag: 'path', segs, fill, stroke, sw});
const circ = (cx, cy, r, fill, stroke = INK, sw = 3) => ({tag: 'circle', cx, cy, r, fill, stroke, sw});
const ell = (cx, cy, rx, ry, fill, stroke = INK, sw = 3) => ({tag: 'ellipse', cx, cy, rx, ry, fill, stroke, sw});
const rct = (x, y, width, height, rx, fill, stroke = INK, sw = 3) => ({tag: 'rect', x, y, width, height, rx, fill, stroke, sw});

// ---------------------------------------------------------------------------
// Reading the existing mascot SVGs (svglibrary/, made by make-cats.mjs) and
// converting their relative path data to absolute M/L/C/Z.
// ---------------------------------------------------------------------------
function parsePathD (d) {
    const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
    const segs = [];
    let i = 0;
    let cmd = null;
    let [x, y, sx, sy] = [0, 0, 0, 0];
    const num = () => parseFloat(toks[i++]);
    while (i < toks.length) {
        if (/[a-zA-Z]/.test(toks[i])) {
            cmd = toks[i++];
        }
        const rel = cmd === cmd.toLowerCase();
        const ox = rel ? x : 0;
        const oy = rel ? y : 0;
        switch (cmd.toUpperCase()) {
        case 'M':
            x = ox + num();
            y = oy + num();
            [sx, sy] = [x, y];
            segs.push(['M', x, y]);
            cmd = rel ? 'l' : 'L';
            break;
        case 'L':
            x = ox + num();
            y = oy + num();
            segs.push(['L', x, y]);
            break;
        case 'H':
            x = ox + num();
            segs.push(['L', x, y]);
            break;
        case 'V':
            y = oy + num();
            segs.push(['L', x, y]);
            break;
        case 'C': {
            const v = [num(), num(), num(), num(), num(), num()];
            segs.push(['C', ox + v[0], oy + v[1], ox + v[2], oy + v[3], ox + v[4], oy + v[5]]);
            x = ox + v[4];
            y = oy + v[5];
            break;
        }
        case 'Z':
            segs.push(['Z']);
            [x, y] = [sx, sy];
            break;
        default:
            throw new Error(`unsupported path command ${cmd}`);
        }
    }
    return segs;
}

function loadMascot (name) {
    const text = fs.readFileSync(path.join(openArt, 'svglibrary', `${name}.svg`), 'utf8');
    const shapes = [];
    for (const [, tag, attrText] of text.matchAll(/<(path|circle|ellipse|rect)\s([^>]*?)\/>/g)) {
        const a = Object.fromEntries([...attrText.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
        const sh = {tag, fill: a.fill, stroke: a.stroke, sw: a['stroke-width'] ? +a['stroke-width'] : 3};
        if (tag === 'path') {
            sh.segs = parsePathD(a.d);
        }
        for (const k of ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height']) {
            if (k in a) {
                sh[k] = parseFloat(a[k]);
            }
        }
        shapes.push(sh);
    }
    return shapes;
}

// ---------------------------------------------------------------------------
// Wordmark: hand-drawn marker letters. Each letter is a skeleton of strokes
// drawn three times: a white "sticker" halo, a dark outline, then the colour,
// plus a light marker sheen. Design space: ascender top y=0, x-height y=40,
// baseline y=84.
// ---------------------------------------------------------------------------
const GLYPHS = {
    S: {w: 42, strokes: [path$((p) => p.arc(21, 21, 19, 19, -25, -270).arc(21, 62, 21, 22, -90, 155))]},
    c: {w: 34, strokes: [path$((p) => p.arc(17, 62, 17, 21, -45, -315))]},
    r: {w: 22, strokes: [path$((p) => p.M(0, 42).L(0, 84)), path$((p) => p.M(0, 64).C(0, 50, 8, 42, 22, 43))]},
    i: {w: 6, strokes: [path$((p) => p.M(3, 46).L(3, 84))], dot: [3, 21]},
    b: {w: 34, strokes: [path$((p) => p.M(0, 0).L(0, 84)), path$((p) => p.arc(17, 62, 17, 21, 180, 540))]},
    l: {w: 11, strokes: [path$((p) => p.M(0, 0).L(0, 72).C(0, 80, 3, 85, 11, 83))]},
    e: {w: 35, strokes: [path$((p) => p.M(1, 63).L(34, 63).arc(17.5, 63, 16.5, 20, 0, -310))]},
    J: {w: 38, strokes: [path$((p) => p.M(10, 0).L(38, 0)), path$((p) => p.M(28, 0).L(28, 58).arc(14, 58, 14, 25, 0, 165))]}
};

// Letter, colour, sheen, tilt (deg), vertical bounce.
const WORD = [
    ['S', '#ff5a5f', '#ffb3b5', -7, -2],
    ['c', '#ff9f1c', '#ffd49a', 5, 3],
    ['r', '#ffd23f', '#fff0b3', -4, -1],
    ['i', '#46c46b', '#b5ecc6', 3, 2],
    ['b', '#2bb3a4', '#a6e6de', -2, -3],
    ['b', '#8e6bd8', '#d2c3f2', 4, 1],
    ['l', '#ff7eb6', '#ffd0e5', -5, -2],
    ['e', '#ff5a5f', '#ffb3b5', 6, 2],
    [' '],
    ['J', '#ffd23f', '#fff0b3', -6, -4],
    ['r', '#46c46b', '#b5ecc6', 7, 1]
];

const GAP = 19;
const SPACE = 40;
const CORE = 14;
const OUTLINE = CORE + 8;
const HALO = OUTLINE + 10;

function layoutWord () {
    const letters = [];
    let x = 0;
    for (const [ch, col, sheen, deg, dy] of WORD) {
        if (ch === ' ') {
            x += SPACE - GAP;
            continue;
        }
        const g = GLYPHS[ch];
        const m = mapper({deg, ox: g.w / 2, oy: 52, tx: x, ty: dy});
        letters.push({
            col, sheen,
            strokes: g.strokes.map((s) => mapSegs(s, m)),
            dot: g.dot ? m(...g.dot) : null
        });
        x += g.w + GAP;
    }
    return letters;
}

function boundsOf (letters, pad) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x, y) => {
        x0 = Math.min(x0, x - pad);
        x1 = Math.max(x1, x + pad);
        y0 = Math.min(y0, y - pad);
        y1 = Math.max(y1, y + pad);
    };
    for (const l of letters) {
        for (const s of l.strokes) {
            for (const sg of s) {
                for (let i = 1; i < sg.length; i += 2) {
                    add(sg[i], sg[i + 1]);
                }
            }
        }
        if (l.dot) {
            add(l.dot[0], l.dot[1]);
        }
    }
    return [x0, y0, x1, y1];
}

function wordmark (W, H, {halo, margin}) {
    const letters = layoutWord();
    const pad = (halo ? HALO : OUTLINE) / 2;
    const [x0, y0, x1, y1] = boundsOf(letters, pad);
    const s = Math.min((W - 2 * margin) / (x1 - x0), (H - 2 * margin) / (y1 - y0));
    const tx = (W - (x1 - x0) * s) / 2 - x0 * s;
    const ty = (H - (y1 - y0) * s) / 2 - y0 * s;
    const fit = {s, tx, ty};
    const shapes = [];
    const layer = (l, fill, sw, off = 0) => {
        for (const st of l.strokes) {
            shapes.push(transformShape(pth(mapSegs(st, mapper({tx: off, ty: off})), 'none', fill, sw), fit));
        }
        if (l.dot) {
            shapes.push(transformShape(circ(l.dot[0] + off, l.dot[1] + off, sw / 2 + (off ? 0.5 : 3), fill, 'none'), fit));
        }
    };
    if (halo) {
        for (const l of letters) {
            layer(l, '#ffffff', HALO);
        }
    }
    for (const l of letters) {
        layer(l, INK, OUTLINE);
        layer(l, l.col, CORE);
        layer(l, l.sheen, 4, -3);
    }
    return shapes;
}

// ---------------------------------------------------------------------------
// Tabby's big face (Cat.svg and the app icon). Design box 178 x 172.
// ---------------------------------------------------------------------------
const GREY = '#a9b0bc';
const STRIPE = '#6f7684';

function tabbyFace () {
    return [
        pth(path$((p) => p.M(30, 74).L(20, 8).L(80, 40).Z()), GREY),
        pth(path$((p) => p.M(148, 74).L(158, 8).L(98, 40).Z()), GREY),
        pth(path$((p) => p.M(36, 60).L(31, 25).L(62, 43).Z()), '#f2b6c4', INK, 2.5),
        pth(path$((p) => p.M(142, 60).L(147, 25).L(116, 43).Z()), '#f2b6c4', INK, 2.5),
        ell(89, 102, 80, 66, GREY),
        pth(path$((p) => p.M(69, 44).L(74, 60)), 'none', STRIPE, 6),
        pth(path$((p) => p.M(89, 40).L(89, 57)), 'none', STRIPE, 6),
        pth(path$((p) => p.M(109, 44).L(104, 60)), 'none', STRIPE, 6),
        pth(path$((p) => p.M(13, 100).L(30, 101)), 'none', STRIPE, 6),
        pth(path$((p) => p.M(16, 118).L(31, 116)), 'none', STRIPE, 6),
        pth(path$((p) => p.M(165, 100).L(148, 101)), 'none', STRIPE, 6),
        pth(path$((p) => p.M(162, 118).L(147, 116)), 'none', STRIPE, 6),
        ell(89, 134, 32, 22, '#d6dae2', 'none'),
        ell(61, 98, 15, 19, '#ffffff'),
        ell(117, 98, 15, 19, '#ffffff'),
        circ(64, 102, 9, INK, 'none'),
        circ(114, 102, 9, INK, 'none'),
        circ(67.5, 97.5, 3.2, '#ffffff', 'none'),
        circ(117.5, 97.5, 3.2, '#ffffff', 'none'),
        ell(40, 128, 11, 7, '#f5a3b7', 'none'),
        ell(138, 128, 11, 7, '#f5a3b7', 'none'),
        pth(path$((p) => p.M(80, 120).C(80, 116, 98, 116, 98, 120).C(98, 124, 92, 128, 89, 129).C(86, 128, 80, 124, 80, 120).Z()), '#e57a92', INK, 2.5),
        pth(path$((p) => p.M(89, 129).L(89, 134).C(87, 142, 77, 143, 73, 136)), 'none', INK, 3),
        pth(path$((p) => p.M(89, 134).C(91, 142, 101, 143, 105, 136)), 'none', INK, 3)
    ];
}

// ---------------------------------------------------------------------------
// Plum waving (FunkyPurple). Plum's art is reused as-is, shifted right to make
// room for a raised paw.
// ---------------------------------------------------------------------------
function plumWaving () {
    const PURPLE = '#9b6fd6';
    const DX = 30;
    const DY = 4;
    const plum = loadMascot('Plum').map((sh) => transformShape(sh, {tx: DX, ty: DY}));
    const arm = path$((p) => p.M(40 + DX, 140 + DY).C(26 + DX, 136 + DY, 10 + DX, 130 + DY, -6 + DX, 112 + DY));
    const armShapes = [
        pth(arm, 'none', INK, 17),
        pth(arm, 'none', PURPLE, 11),
        circ(-8 + DX, 108 + DY, 10, PURPLE),
        pth(path$((p) => p.M(-14 + DX, 102 + DY).L(-12 + DX, 98 + DY)), 'none', INK, 2),
        pth(path$((p) => p.M(-6 + DX, 99 + DY).L(-5 + DX, 95 + DY)), 'none', INK, 2),
        // wave motion marks
        pth(path$((p) => p.arc(-8 + DX, 108 + DY, 20, 20, 200, 250)), 'none', INK, 3),
        pth(path$((p) => p.arc(-8 + DX, 108 + DY, 27, 27, 205, 245)), 'none', INK, 3)
    ];
    // Draw tail + body + belly first, then the arm, then the head over the shoulder.
    return [...plum.slice(0, 4), ...armShapes, ...plum.slice(4)];
}

// ---------------------------------------------------------------------------
// Sparky (FunkyRed): an original red robot dangling from a rope and waving.
// The start screen shows it partly above the top edge, so the top third is rope.
// ---------------------------------------------------------------------------
function sparky () {
    const RED = '#ef5b3a';
    const ORANGE = '#ff8c42';
    const CREAM = '#fff4e0';
    const STEEL = '#8d94a0';
    const YELLOW = '#ffd34d';
    const wave = path$((p) => p.M(52, 250).C(36, 244, 24, 232, 20, 212));
    const hang = path$((p) => p.M(128, 250).C(142, 260, 148, 274, 146, 290));
    return [
        pth(path$((p) => p.M(90, 0).L(90, 120)), 'none', INK, 7),
        pth(path$((p) => p.M(90, 0).L(90, 120)), 'none', '#f4dca8', 3),
        circ(90, 125, 8, 'none', INK, 4),
        pth(path$((p) => p.M(90, 133).L(90, 148)), 'none', INK, 5),
        // legs and feet
        rct(64, 290, 16, 20, 4, STEEL),
        rct(100, 290, 16, 20, 4, STEEL),
        rct(54, 306, 32, 17, 8, RED),
        rct(94, 306, 32, 17, 8, RED),
        // arms
        pth(wave, 'none', INK, 17),
        pth(wave, 'none', STEEL, 11),
        pth(hang, 'none', INK, 17),
        pth(hang, 'none', STEEL, 11),
        circ(19, 206, 11, YELLOW),
        circ(146, 294, 10, YELLOW),
        pth(path$((p) => p.arc(19, 206, 21, 21, 195, 250)), 'none', INK, 3),
        pth(path$((p) => p.arc(19, 206, 28, 28, 200, 245)), 'none', INK, 3),
        // body
        rct(80, 220, 20, 14, 3, STEEL),
        rct(46, 230, 88, 66, 18, ORANGE),
        rct(62, 244, 56, 36, 9, CREAM),
        circ(77, 258, 6, '#2bb3a4', INK, 2.5),
        circ(96, 258, 6, YELLOW, INK, 2.5),
        pth(path$((p) => p.M(70, 271).L(110, 271)), 'none', INK, 3),
        circ(108, 258, 2.5, RED, 'none'),
        // head
        rct(29, 170, 14, 28, 5, YELLOW),
        rct(137, 170, 14, 28, 5, YELLOW),
        rct(38, 146, 104, 78, 24, RED),
        rct(53, 159, 74, 52, 15, CREAM),
        circ(76, 182, 8.5, INK, 'none'),
        circ(104, 182, 8.5, INK, 'none'),
        circ(79, 179, 2.7, '#ffffff', 'none'),
        circ(107, 179, 2.7, '#ffffff', 'none'),
        ell(64, 198, 5.5, 3.5, '#ff9aa8', 'none'),
        ell(116, 198, 5.5, 3.5, '#ff9aa8', 'none'),
        pth(path$((p) => p.M(81, 196).C(86, 203, 94, 203, 99, 196)), 'none', INK, 3),
        circ(52, 156, 2.5, '#ffd2c4', 'none'),
        circ(128, 156, 2.5, '#ffd2c4', 'none')
    ];
}

// ---------------------------------------------------------------------------
// App icon: Tabby's face on a warm yellow rounded square.
// ---------------------------------------------------------------------------
function appIcon () {
    const s = 4.5;
    const face = tabbyFace().map((sh) => transformShape(sh, {s, tx: 512 - 89 * s, ty: 540 - 92 * s}));
    return [
        rct(40, 40, 944, 944, 210, '#ffc83d', '#e9a514', 16),
        circ(512, 560, 360, '#ffd96b', 'none'),
        ...face
    ];
}

// ---------------------------------------------------------------------------
// Credits text (plain <text> is fine here: it's only legal text).
// ---------------------------------------------------------------------------
function creditsSvg () {
    const font = 'Segoe UI, Arial, sans-serif';
    const lines = [
        ['Scribble Jr — a Windows app for young coders', 34, 'bold', 42],
        ['Adapted by James and Peter Rafferty', 25, 'bold', 82],
        ['Based on ScratchJr by the DevTech Research Group at Tufts University,', 23, 'normal', 126],
        ['the Lifelong Kindergarten Group at the MIT Media Lab and Playful Invention Company.', 23, 'normal', 158],
        ['Not affiliated with or endorsed by MIT or Tufts.', 21, 'normal', 204]
    ];
    const body = lines.map(([t, size, weight, y]) =>
        `<text x="490" y="${y}" text-anchor="middle" fill="#2a9fd6" font-family="${font}" font-size="${size}" font-weight="${weight}">${t}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="980px" height="237px" viewBox="0 0 980 237">${body}</svg>\n`;
}

// ---------------------------------------------------------------------------
const outputs = [
    ['ScratchJrLogo.svg', path.join(src, 'start'), svgDoc('ScratchJrLogo', 442, 126, wordmark(442, 126, {halo: true, margin: 2}))],
    ['scratchJrlogo.svg', path.join(src, 'lobby'), svgDoc('scratchJrlogo', 220, 77, wordmark(220, 77, {halo: false, margin: 3}))],
    ['Cat.svg', path.join(src, 'start'), svgDoc('Cat', 178, 172, tabbyFace())],
    ['FunkyPurple.svg', path.join(src, 'start'), svgDoc('FunkyPurple', 182, 200, plumWaving())],
    ['FunkyRed.svg', path.join(src, 'start'), svgDoc('FunkyRed', 180, 326, sparky())],
    ['FunkyBlue.svg', path.join(src, 'start'), svgDoc('FunkyBlue', 132, 206, loadMascot('Nova'))],
    ['creditsText.svg', path.join(src, 'start'), creditsSvg()],
    ['app-icon.svg', path.join(desktop, 'icon'), svgDoc('app-icon', 1024, 1024, appIcon())]
];

for (const [name, dir, svg] of outputs) {
    fs.writeFileSync(path.join(dir, name), svg);
    // The two logos differ only by case on disk; keep distinct names in brand/.
    const copyName = dir.endsWith('lobby') ? `lobby-${name}` : name;
    fs.writeFileSync(path.join(brandDir, copyName), svg);
}
console.log('wrote', outputs.map((o) => o[0]).join(', '));
