// Generates the CC0 background scenes in ../backgrounds/ (480 x 360 each).
//
// ScratchJr's paint editor reads only a small subset of SVG, so every scene is
// built from <rect>, <circle>, <ellipse>, <polygon> and <path> inside a single
// <g id="Name.svg">. Each shape carries its own fill and stroke attributes and
// path data uses only absolute M, L, C and Z (curves and arcs are cubic Beziers).
// Check the output with: node desktop/open-art/tools/check-svg.mjs desktop/open-art/backgrounds
//
// Usage: node desktop/open-art/tools/make-backgrounds.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backgrounds');
fs.mkdirSync(outDir, {recursive: true});

const W = 480;
const H = 360;
const INK = '#2b2b33';

// ---------------------------------------------------------------------------
// Shape output
// ---------------------------------------------------------------------------

const f = (n) => {
    const v = Math.round(n * 100) / 100;
    return Object.is(v, -0) ? '0' : String(v);
};

let shapes = null;

// ink: falsy = no outline, number = dark outline of that width, [colour, width] = coloured outline.
function strokeAttrs (ink) {
    if (!ink) {
        return {stroke: 'none'};
    }
    const [colour, width] = typeof ink === 'number' ? [INK, ink] : ink;
    return {stroke: colour, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'};
}
function add (tag, geo, fill, ink) {
    shapes.push([tag, {...geo, fill, ...strokeAttrs(ink)}]);
}
const rect = (x, y, w, h, fill, ink) => add('rect', {x: f(x), y: f(y), width: f(w), height: f(h)}, fill, ink);
const circle = (cx, cy, r, fill, ink) => add('circle', {cx: f(cx), cy: f(cy), r: f(r)}, fill, ink);
const ellipse = (cx, cy, rx, ry, fill, ink) => add('ellipse', {cx: f(cx), cy: f(cy), rx: f(rx), ry: f(ry)}, fill, ink);
const poly = (pts, fill, ink) => add('polygon', {points: pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}, fill, ink);
const shape = (d, fill, ink) => add('path', {d: String(d)}, fill, ink);
// An open stroked line (fill="none").
const line = (d, colour, width) => add('path', {d: String(d)}, 'none', [colour, width]);
// A line drawn twice: dark outline underneath, colour on top (for vines, poles, ropes...).
const inkLine = (d, colour, width, outline = 3) => {
    line(d, INK, width + outline * 2);
    line(d, colour, width);
};

// ---------------------------------------------------------------------------
// Path building (absolute M / L / C / Z only)
// ---------------------------------------------------------------------------

class D {
    constructor () {
        this.parts = [];
    }
    M (x, y) {
        this.parts.push(`M${f(x)} ${f(y)}`);
        return this;
    }
    L (x, y) {
        this.parts.push(`L${f(x)} ${f(y)}`);
        return this;
    }
    C (x1, y1, x2, y2, x, y) {
        this.parts.push(`C${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)}`);
        return this;
    }
    // Quadratic curve written as the equivalent cubic. Needs the current point.
    Q (x0, y0, qx, qy, x, y) {
        return this.C(x0 + (qx - x0) * 2 / 3, y0 + (qy - y0) * 2 / 3, x + (qx - x) * 2 / 3, y + (qy - y) * 2 / 3, x, y);
    }
    Z () {
        this.parts.push('Z');
        return this;
    }
    toString () {
        return this.parts.join(' ');
    }
}
const d = () => new D();

// Catmull-Rom spline through pts, appended as cubic segments (current point must be pts[0]).
function spline (path, pts, closed = false, tension = 1) {
    const n = pts.length;
    const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
        const [p0, p1, p2, p3] = [get(i - 1), get(i), get(i + 1), get(i + 2)];
        path.C(p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension,
            p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension, p2[0], p2[1]);
    }
    return path;
}
const smoothClosed = (pts, t) => spline(d().M(...pts[0]), pts, true, t).Z();
const smoothOpen = (pts, t) => spline(d().M(...pts[0]), pts, false, t);
// A smooth ridge line through pts, filled down to `bottom`.
const hills = (pts, bottom = H + 10) => spline(d().M(pts[0][0], bottom).L(...pts[0]), pts).L(pts[pts.length - 1][0], bottom).Z();

// Elliptical arc as cubic segments (degrees, clockwise on screen when a1 > a0).
function arc (path, cx, cy, rx, ry, a0, a1, move = false) {
    const rad = Math.PI / 180;
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
    const step = (a1 - a0) / n;
    const k = 4 / 3 * Math.tan(step * rad / 4);
    if (move) {
        path.M(cx + rx * Math.cos(a0 * rad), cy + ry * Math.sin(a0 * rad));
    }
    for (let i = 0; i < n; i++) {
        const a = (a0 + step * i) * rad;
        const b = (a0 + step * (i + 1)) * rad;
        path.C(cx + rx * (Math.cos(a) - k * Math.sin(a)), cy + ry * (Math.sin(a) + k * Math.cos(a)),
            cx + rx * (Math.cos(b) + k * Math.sin(b)), cy + ry * (Math.sin(b) - k * Math.cos(b)),
            cx + rx * Math.cos(b), cy + ry * Math.sin(b));
    }
    return path;
}

// Points round a circle with alternating radius, for bumpy tree crowns and bushes.
function scallop (cx, cy, rx, ry, n, bump, start = -90) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
        const a = (start + i * 180 / n) * Math.PI / 180;
        const s = i % 2 === 0 ? 1 : 1 - bump;
        pts.push([cx + rx * s * Math.cos(a), cy + ry * s * Math.sin(a)]);
    }
    return pts;
}

function starPts (cx, cy, R, r, n = 5, rot = -90) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
        const a = (rot + i * 180 / n) * Math.PI / 180;
        const rr = i % 2 === 0 ? R : r;
        pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    return pts;
}

// A pointed leaf from (x0,y0) to (x1,y1), `w` wide, bending by `bend` (perpendicular).
function leafPath (x0, y0, x1, y1, w, bend = 0) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const at = (t, off) => [x0 + dx * t + nx * (off + bend * Math.sin(Math.PI * t)), y0 + dy * t + ny * (off + bend * Math.sin(Math.PI * t))];
    const a1 = at(0.3, w);
    const a2 = at(0.75, w * 0.8);
    const b2 = at(0.75, -w * 0.8);
    const b1 = at(0.3, -w);
    return d().M(x0, y0).C(...a1, ...a2, x1, y1).C(...b2, ...b1, x0, y0).Z();
}

// Rounded rectangle as a path (rx is not used: keep to the simplest attributes).
function roundRect (x, y, w, h, r) {
    const k = r * 0.55;
    return d().M(x + r, y).L(x + w - r, y).C(x + w - r + k, y, x + w, y + r - k, x + w, y + r)
        .L(x + w, y + h - r).C(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h)
        .L(x + r, y + h).C(x + r - k, y + h, x, y + h - r + k, x, y + h - r)
        .L(x, y + r).C(x, y + r - k, x + r - k, y, x + r, y).Z();
}

// Deterministic pseudo-random numbers so the output is stable between runs.
function rng (seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Shared scenery pieces
// ---------------------------------------------------------------------------

const sky = (colour) => rect(-4, -4, W + 8, H + 8, colour);
// Horizontal colour bands from top to bottom: [[y, colour], ...].
const bands = (list) => list.forEach(([y, c], i) => rect(-4, y, W + 8, (i + 1 < list.length ? list[i + 1][0] : H + 4) - y + 1, c));

function sun (x, y, r) {
    circle(x, y, r * 1.45, '#fff4bf');
    circle(x, y, r, '#ffd84d', ['#f2b230', 3]);
}

function cloud (x, y, s = 1, c = '#ffffff') {
    ellipse(x - 26 * s, y + 6 * s, 22 * s, 13 * s, c);
    ellipse(x + 27 * s, y + 6 * s, 24 * s, 13 * s, c);
    ellipse(x + 2 * s, y + 1 * s, 32 * s, 18 * s, c);
    ellipse(x + 6 * s, y - 11 * s, 19 * s, 15 * s, c);
}

function tree (x, gy, s = 1, leaf = '#5bb84f', light = '#7fd16a') {
    poly([[x - 9 * s, gy], [x - 6 * s, gy - 58 * s], [x + 6 * s, gy - 58 * s], [x + 9 * s, gy]], '#9a6a3f', 3);
    shape(smoothClosed(scallop(x, gy - 88 * s, 44 * s, 40 * s, 9, 0.1)), leaf, 3);
    ellipse(x - 14 * s, gy - 102 * s, 15 * s, 10 * s, light);
}

function pine (x, gy, s = 1, leaf = '#3f9a5a', snow = false) {
    rect(x - 5 * s, gy - 16 * s, 10 * s, 16 * s, '#8a5a36', 2.5);
    const tiers = [[gy - 14, 34, 40], [gy - 42, 28, 38], [gy - 68, 21, 34]];
    for (const [base, hw, h] of tiers) {
        const b = gy - (gy - base) * s;
        poly([[x - hw * s, b], [x, b - h * s], [x + hw * s, b]], leaf, 2.5);
        if (snow) {
            poly([[x - hw * s * 0.42, b - h * s * 0.58], [x, b - h * s], [x + hw * s * 0.42, b - h * s * 0.58],
                [x + hw * s * 0.15, b - h * s * 0.5], [x, b - h * s * 0.6], [x - hw * s * 0.18, b - h * s * 0.5]], '#ffffff', 2);
        }
    }
}

// A bush made of overlapping round bumps. Each piece is drawn once with a thick
// outline, then again without, so only the outer edge of the union stays inked.
function bush (x, gy, w, h, c, ink = 3) {
    const n = Math.max(3, Math.round(w / 18));
    const r = Math.min(h * 0.45, w / 3);
    const pieces = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const cx = x - w / 2 + r + (w - 2 * r) * t;
        const cy = gy - h + r + (1 - Math.sin(Math.PI * t)) * h * 0.1;
        pieces.push(cx, cy);
    }
    const base = [x - w / 2, gy - h * 0.45, w, h * 0.45];
    for (let i = 0; i < pieces.length; i += 2) {
        circle(pieces[i], pieces[i + 1], r, c, ink);
    }
    rect(...base, c, ink);
    for (let i = 0; i < pieces.length; i += 2) {
        circle(pieces[i], pieces[i + 1], r - ink / 2, c);
    }
    rect(base[0] + ink / 2, base[1] - ink / 2, base[2] - ink, base[3], c);
}

function flower (x, gy, petal, h = 22, r = 4.5) {
    line(d().M(x, gy).C(x - 2, gy - h / 3, x + 2, gy - h * 2 / 3, x, gy - h), '#3f9a4a', 3);
    const cy = gy - h;
    for (let i = 0; i < 5; i++) {
        const a = (-90 + i * 72) * Math.PI / 180;
        circle(x + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3, r, petal, 1.5);
    }
    circle(x, cy, r * 0.85, '#ffd84d', 1.5);
}

function grassTuft (x, y, c = '#4e9f3d', s = 1) {
    line(d().M(x - 6 * s, y).C(x - 6 * s, y - 5 * s, x - 8 * s, y - 8 * s, x - 10 * s, y - 10 * s)
        .M(x, y).C(x, y - 6 * s, x, y - 10 * s, x + 1 * s, y - 13 * s)
        .M(x + 6 * s, y).C(x + 6 * s, y - 5 * s, x + 8 * s, y - 8 * s, x + 10 * s, y - 10 * s), c, 2.5);
}

function picketFence (x0, x1, base, h, c = '#ffffff', step = 22) {
    rect(x0, base - h * 0.75, x1 - x0, 7, c, 2.5);
    rect(x0, base - h * 0.32, x1 - x0, 7, c, 2.5);
    for (let x = x0 + 4; x < x1 - 6; x += step) {
        poly([[x, base], [x, base - h + 6], [x + 6, base - h], [x + 12, base - h + 6], [x + 12, base]], c, 2.5);
    }
}

function stars (seed, n, yMax, colours = ['#ffffff', '#fff3a8'], avoid = () => false) {
    const r = rng(seed);
    let placed = 0;
    while (placed < n) {
        const x = 6 + r() * (W - 12);
        const y = 6 + r() * (yMax - 6);
        const size = 1.2 + r() * 1.8;
        if (avoid(x, y)) {
            continue;
        }
        circle(x, y, size, colours[placed % colours.length]);
        placed++;
    }
}

function sparkle (x, y, s, c = '#ffffff') {
    poly([[x, y - s], [x + s * 0.25, y - s * 0.25], [x + s, y], [x + s * 0.25, y + s * 0.25], [x, y + s],
        [x - s * 0.25, y + s * 0.25], [x - s, y], [x - s * 0.25, y - s * 0.25]], c);
}

function window4 (x, y, w, h, glass = '#bfe8ff', frame = '#ffffff') {
    rect(x - 6, y - 6, w + 12, h + 12, frame, 3);
    rect(x, y, w, h, glass, 2.5);
    line(d().M(x + w / 2, y).L(x + w / 2, y + h).M(x, y + h / 2).L(x + w, y + h / 2), frame, 5);
}

function bird (x, y, s = 1, c = INK) {
    line(d().M(x - 9 * s, y - 2 * s).C(x - 6 * s, y - 6 * s, x - 2 * s, y - 5 * s, x, y)
        .C(x + 2 * s, y - 5 * s, x + 6 * s, y - 6 * s, x + 9 * s, y - 2 * s), c, 2.5);
}

function butterfly (x, y, c) {
    ellipse(x - 6, y - 4, 6, 5, c, 1.5);
    ellipse(x + 6, y - 4, 6, 5, c, 1.5);
    ellipse(x - 5, y + 4, 4.5, 4, c, 1.5);
    ellipse(x + 5, y + 4, 4.5, 4, c, 1.5);
    line(d().M(x, y - 6).L(x, y + 7), INK, 3);
}

// ---------------------------------------------------------------------------
// Scenes. Ground or floor sits roughly between y = 240 and y = 270 so characters
// can stand on it; the middle of each picture is kept fairly open.
// ---------------------------------------------------------------------------

const scenes = [];
const scene = (name, title, draw) => scenes.push({name, title, draw});

scene('Park', 'Park', () => {
    sky('#bfe6ff');
    sun(404, 62, 28);
    cloud(96, 60, 1);
    cloud(262, 42, 0.72);
    shape(hills([[-10, 210], [70, 186], [170, 204], [270, 184], [370, 202], [440, 182], [490, 194]]), '#acdd8c');
    for (const [x, y, r] of [[160, 202, 13], [186, 205, 10], [318, 196, 12], [340, 199, 9]]) {
        rect(x - 2, y, 4, 9, '#8a6a4a');
        circle(x, y - 4, r, '#86c77a');
    }
    shape(hills([[-10, 244], [110, 236], [240, 242], [360, 234], [490, 242]]), '#7cc95a');
    shape(d().M(196, 364).C(212, 322, 250, 286, 292, 246).L(316, 246).C(290, 288, 276, 324, 300, 364).Z(), '#eed9a6');
    ellipse(92, 318, 64, 19, '#7fd3f2', ['#4aa7cf', 3]);
    line(d().M(62, 314).L(84, 314).M(100, 322).L(126, 322), '#ffffff', 3);
    tree(52, 262, 1.25);
    tree(438, 256, 1.05, '#6cc35a', '#97dd7f');
    bush(150, 256, 70, 38, '#4fae4a');
    bush(374, 252, 56, 30, '#5bb84f');
    // bench
    rect(352, 280, 6, 22, '#6b4a2e', 2);
    rect(402, 280, 6, 22, '#6b4a2e', 2);
    rect(354, 252, 6, 26, '#6b4a2e', 2);
    rect(400, 252, 6, 26, '#6b4a2e', 2);
    rect(344, 256, 72, 8, '#d58a4a', 2.5);
    rect(344, 266, 72, 8, '#d58a4a', 2.5);
    rect(340, 276, 80, 9, '#c27a3e', 2.5);
    flower(26, 346, '#ff7aa8');
    flower(178, 340, '#ffd84d', 18, 4);
    flower(410, 340, '#9b7bff');
    flower(452, 326, '#ff7a5c', 18, 4);
    grassTuft(228, 300);
    grassTuft(352, 334);
    grassTuft(18, 286);
    bird(210, 92);
    bird(232, 104, 0.8);
});

scene('Farm', 'Farm', () => {
    sky('#c8ecff');
    sun(64, 58, 26);
    cloud(250, 52, 0.9);
    cloud(400, 80, 0.65);
    shape(hills([[-10, 214], [90, 196], [210, 210], [330, 188], [490, 206]]), '#f2d675');
    line(d().M(250, 207).C(290, 198, 320, 194, 350, 190).M(240, 216).C(300, 206, 350, 200, 420, 198)
        .M(260, 226).C(330, 214, 400, 208, 480, 208), '#d9b552', 3);
    shape(hills([[-10, 236], [120, 226], [260, 240], [380, 228], [490, 236]]), '#8fd36a');
    // silo (behind the barn)
    rect(150, 142, 36, 112, '#cfd3dc', 3);
    shape(arc(d().M(150, 142), 168, 142, 18, 18, 180, 360).Z(), '#9aa2b4', 3);
    line(d().M(150, 168).L(186, 168).M(150, 196).L(186, 196).M(150, 224).L(186, 224), '#9aa2b4', 3);
    // barn
    poly([[24, 258], [24, 178], [42, 150], [86, 128], [130, 150], [148, 178], [148, 258]], '#d9493c', 3);
    poly([[16, 182], [38, 146], [86, 120], [134, 146], [156, 182], [148, 186], [128, 154], [86, 132], [44, 154], [24, 186]], '#f2f2f2', 3);
    rect(72, 154, 28, 24, '#f2f2f2', 3);
    rect(76, 158, 20, 16, '#5a3a2a', 2);
    rect(56, 204, 60, 54, '#f2f2f2', 3);
    rect(62, 210, 48, 48, '#b83a2f', 2.5);
    line(d().M(62, 210).L(110, 258).M(110, 210).L(62, 258), '#f2f2f2', 5);
    // fence
    for (let x = 206; x < 480; x += 46) {
        rect(x, 230, 9, 36, '#b07a4a', 2.5);
    }
    rect(196, 238, 290, 7, '#c98d55', 2.5);
    rect(196, 252, 290, 7, '#c98d55', 2.5);
    for (let x = 206; x < 480; x += 46) {
        rect(x, 230, 9, 6, '#b07a4a', 2.5);
    }
    // hay bale
    shape(d().M(392, 286).L(392, 254).C(392, 236, 410, 230, 430, 230).C(450, 230, 468, 236, 468, 254).L(468, 286).Z(), '#f2c94c', 3);
    line(d().M(404, 248).L(412, 270).M(426, 242).L(430, 278).M(450, 248).L(446, 274), '#d9a92c', 3);
    // dirt track and tufts
    shape(d().M(130, 364).C(150, 320, 170, 290, 160, 258).L(176, 258).C(196, 292, 196, 326, 214, 364).Z(), '#d8b07a');
    grassTuft(250, 300);
    grassTuft(330, 330);
    grassTuft(40, 320);
    grassTuft(440, 340);
    flower(300, 350, '#ffffff', 16, 4);
    flower(70, 350, '#ffd84d', 16, 4);
});

scene('City', 'City', () => {
    sky('#cfe9ff');
    cloud(330, 50, 0.8);
    cloud(130, 76, 0.6);
    // far skyline
    const far = [[0, 120, 50], [46, 96, 40], [84, 132, 46], [126, 84, 34], [158, 112, 52], [206, 70, 36], [238, 104, 48],
        [282, 90, 40], [318, 124, 44], [358, 80, 36], [390, 110, 50], [436, 96, 48]];
    for (const [x, y, w] of far) {
        rect(x, y, w, 260 - y, '#b4c7e2');
    }
    for (const [x, y, w] of far) {
        for (let wy = y + 12; wy < 236; wy += 22) {
            for (let wx = x + 8; wx < x + w - 12; wx += 16) {
                rect(wx, wy, 6, 9, '#cfdcef');
            }
        }
    }
    // near buildings, left
    const near = [[-6, 128, 74, '#f28b6b'], [64, 168, 66, '#ffd166'], [348, 150, 62, '#7fc8a9'], [404, 112, 82, '#9b8be0']];
    for (const [x, y, w, c] of near) {
        rect(x, y, w, 262 - y, c, 3);
        for (let wy = y + 14; wy < 236; wy += 26) {
            for (let wx = x + 12; wx + 14 <= x + w - 8; wx += 22) {
                rect(wx, wy, 14, 16, '#e9f6ff', 2);
            }
        }
    }
    rect(84, 226, 26, 36, '#8a5a36', 2.5);
    rect(366, 228, 26, 34, '#5a6a8a', 2.5);
    // sidewalk and road
    rect(-4, 258, W + 8, 36, '#d9d4cb', 3);
    line(d().M(60, 260).L(54, 292).M(160, 260).L(156, 292).M(260, 260).L(260, 292).M(360, 260).L(364, 292), '#bdb6aa', 2);
    rect(-4, 294, W + 8, 70, '#5f6475');
    rect(-4, 294, W + 8, 7, '#8a8e9c');
    for (let x = 10; x < W; x += 80) {
        rect(x, 330, 44, 7, '#ffd84d');
    }
    // street lamp and tree
    inkLine(d().M(312, 258).L(312, 196).C(312, 184, 320, 180, 330, 180), '#4a4f63', 4, 2);
    shape(d().M(322, 178).L(342, 178).L(338, 188).L(326, 188).Z(), '#ffe27a', 2.5);
    rect(176, 236, 8, 24, '#9a6a3f', 2.5);
    shape(smoothClosed(scallop(180, 220, 22, 20, 7, 0.12)), '#5bb84f', 3);
    rect(164, 250, 32, 12, '#c47a4a', 2.5);
    bird(250, 120);
});

scene('Beach', 'Beach', () => {
    sky('#aee3ff');
    sun(380, 66, 30);
    cloud(110, 56, 0.85);
    bird(210, 80);
    bird(236, 94, 0.8);
    rect(-4, 176, W + 8, 90, '#3fb7e0');
    rect(-4, 176, W + 8, 8, '#2a9fcf');
    line(d().M(40, 204).C(50, 198, 60, 198, 70, 204).M(150, 222).C(160, 216, 170, 216, 180, 222)
        .M(300, 200).C(310, 194, 320, 194, 330, 200).M(400, 226).C(410, 220, 420, 220, 430, 226), '#bfeeff', 3);
    // little sailboat on the horizon
    shape(d().M(262, 182).L(296, 182).L(290, 190).L(268, 190).Z(), '#e8553d', 2);
    poly([[279, 180], [279, 152], [296, 178]], '#ffffff', 2);
    // sand and foam
    shape(hills([[-10, 248], [120, 254], [260, 244], [400, 252], [490, 246]]), '#ffffff');
    shape(hills([[-10, 256], [120, 262], [260, 252], [400, 260], [490, 254]]), '#f6dc9c');
    // palm tree
    shape(spline(d().M(396, 272), [[396, 272], [402, 224], [410, 184], [424, 146]]).L(440, 148)
        .C(430, 176, 424, 200, 420, 226).C(416, 242, 414, 256, 414, 272).Z(), '#c98d55', 3);
    for (const [y, x] of [[170, 424], [198, 416], [228, 410], [254, 406]]) {
        line(d().M(x - 8, y).C(x - 2, y + 4, x + 4, y + 4, x + 10, y), '#9a6a3f', 2.5);
    }
    const top = [432, 144];
    for (const [x, y, b, c] of [[370, 134, -12, '#3f9a4a'], [474, 120, 12, '#3f9a4a'], [376, 186, 12, '#4fae4a'],
        [476, 182, -12, '#4fae4a'], [420, 92, -8, '#5cc46a'], [458, 98, 8, '#5cc46a']]) {
        shape(leafPath(top[0], top[1], x, y, 12, b), c, 3);
    }
    circle(426, 152, 7, '#8a5a36', 2.5);
    circle(439, 154, 7, '#8a5a36', 2.5);
    // umbrella
    inkLine(d().M(80, 300).L(80, 196), '#ffffff', 4, 2);
    const cols = ['#ff6b6b', '#ffffff', '#ff6b6b', '#ffffff'];
    for (let i = 0; i < 4; i++) {
        const a0 = 180 + i * 45;
        const p = arc(d().M(80, 200).L(80 + 60 * Math.cos(a0 * Math.PI / 180), 214 + 34 * Math.sin(a0 * Math.PI / 180)), 80, 214, 60, 34, a0, a0 + 45).Z();
        shape(p, cols[i], 3);
    }
    // towel, bucket, shells, starfish
    poly([[24, 296], [128, 286], [146, 316], [40, 328]], '#7f8cff', 3);
    line(d().M(46, 298).L(60, 324).M(110, 290).L(126, 318), '#ffd84d', 4);
    poly([[354, 300], [388, 300], [384, 330], [358, 330]], '#ffd84d', 3);
    line(d().M(356, 300).C(358, 282, 384, 282, 386, 300), INK, 3);
    shape(d().M(392, 330).L(416, 318).L(422, 324).L(398, 334).Z(), '#ff8c42', 2.5);
    poly(starPts(206, 330, 13, 6), '#ff8c6b', 2.5);
    shape(arc(d().M(268, 318), 280, 318, 12, 10, 180, 360).Z(), '#ffc7d9', 2.5);
    line(d().M(280, 318).L(280, 309).M(274, 318).L(272, 311).M(286, 318).L(288, 311), INK, 1.5);
});

scene('Underwater', 'Underwater', () => {
    bands([[-4, '#7fdcf2'], [70, '#5fcbea'], [150, '#45b7df'], [230, '#3aa6d4']]);
    for (const [x, w] of [[60, 34], [170, 24], [300, 40], [410, 26]]) {
        poly([[x, -4], [x + w, -4], [x + w + 70, 260], [x + 40, 260]], '#8fe3f5');
    }
    shape(hills([[-10, 266], [90, 252], [200, 262], [320, 250], [420, 260], [490, 252]]), '#f0d79a');
    // rocks
    shape(smoothClosed([[10, 270], [30, 232], [70, 226], [96, 250], [100, 272]]), '#8d97a8', 3);
    shape(smoothClosed([[390, 262], [404, 236], [440, 230], [470, 246], [476, 266]]), '#9aa4b6', 3);
    // seaweed
    const weed = (x, gy, h, sway, c) => inkLine(smoothOpen([[x, gy], [x + sway, gy - h * 0.33], [x - sway, gy - h * 0.66], [x + sway * 0.5, gy - h]]), c, 9, 2.5);
    weed(40, 252, 120, 12, '#3fae5a');
    weed(64, 248, 90, -10, '#5cc46a');
    weed(118, 262, 70, 9, '#3fae5a');
    weed(424, 244, 110, -12, '#5cc46a');
    weed(452, 250, 140, 10, '#3fae5a');
    // coral
    const coral = (x, gy, c) => inkLine(d().M(x, gy).L(x, gy - 30).L(x - 16, gy - 50).M(x, gy - 30).L(x + 14, gy - 56)
        .M(x - 8, gy - 40).L(x - 4, gy - 64).M(x + 7, gy - 43).L(x + 26, gy - 46), c, 7, 2.5);
    coral(350, 262, '#ff7a8a');
    coral(160, 266, '#ffa94d');
    // shell, starfish, chest
    poly(starPts(250, 300, 15, 7), '#ff8c6b', 2.5);
    shape(arc(d().M(84, 312), 98, 312, 14, 12, 180, 360).Z(), '#ffd1e0', 2.5);
    line(d().M(98, 312).L(98, 302).M(91, 312).L(88, 303).M(105, 312).L(108, 303), INK, 1.5);
    rect(330, 300, 52, 32, '#b5743e', 3);
    shape(d().M(330, 300).L(330, 292).C(330, 280, 382, 280, 382, 292).L(382, 300).Z(), '#c98d55', 3);
    rect(352, 296, 8, 10, '#ffd84d', 2);
    // fish far away
    const fish = (x, y, s, c, dir = 1) => {
        ellipse(x, y, 14 * s, 8 * s, c, 2.5);
        poly([[x - dir * 12 * s, y], [x - dir * 24 * s, y - 8 * s], [x - dir * 24 * s, y + 8 * s]], c, 2.5);
        circle(x + dir * 7 * s, y - 2 * s, 2 * s, INK);
    };
    fish(380, 70, 1, '#ffb84d', -1);
    fish(410, 92, 0.75, '#ffb84d', -1);
    fish(100, 132, 0.9, '#ff7aa8', 1);
    // bubbles
    for (const [x, y, r] of [[140, 210, 6], [146, 186, 4], [138, 166, 5], [300, 120, 5], [306, 100, 3.5], [448, 70, 5], [456, 46, 3.5], [60, 80, 4]]) {
        circle(x, y, r, '#c9f2ff', ['#ffffff', 2]);
    }
});

scene('Space', 'Space', () => {
    sky('#1d2150');
    stars(7, 46, 250, ['#ffffff', '#fff3a8', '#bcd3ff'], (x, y) => Math.hypot(x - 380, y - 84) < 76 || Math.hypot(x - 92, y - 70) < 30);
    sparkle(200, 60, 9);
    sparkle(300, 150, 7, '#fff3a8');
    sparkle(40, 170, 7);
    // ringed planet: back half of the ring, planet, front half
    line(arc(d(), 380, 86, 70, 18, 180, 360, true), '#ffcf6b', 7);
    circle(380, 86, 42, '#ff8c6b', 3);
    line(d().M(346, 66).C(360, 60, 394, 58, 414, 66).M(340, 96).C(360, 104, 400, 106, 420, 96), '#ffb28f', 5);
    line(arc(d(), 380, 86, 70, 18, 0, 180, true), INK, 11);
    line(arc(d(), 380, 86, 70, 18, 0, 180, true), '#ffcf6b', 7);
    // small planet and a comet
    circle(92, 70, 20, '#7fd3f2', 3);
    circle(86, 64, 5, '#5ab8dc');
    circle(100, 78, 3.5, '#5ab8dc');
    line(d().M(150, 140).L(206, 118), '#bcd3ff', 4);
    line(d().M(156, 146).L(202, 128), '#8fa6e8', 3);
    circle(210, 116, 6, '#ffffff', 2);
    // alien ground
    shape(hills([[-10, 236], [80, 218], [190, 232], [300, 214], [400, 228], [490, 220]]), '#5a43a0');
    shape(hills([[-10, 262], [120, 252], [250, 260], [370, 248], [490, 258]]), '#8a6ad6');
    for (const [x, y, rx, ry] of [[60, 290, 34, 9], [190, 330, 26, 7], [330, 300, 40, 10], [430, 336, 22, 6], [110, 346, 18, 5]]) {
        ellipse(x, y, rx, ry, '#6e52bc');
        ellipse(x, y + ry * 0.25, rx * 0.8, ry * 0.65, '#5a43a0');
    }
    // crystals
    poly([[424, 266], [430, 234], [440, 228], [446, 266]], '#7ff0e0', 3);
    poly([[442, 266], [452, 244], [462, 266]], '#b8fff5', 3);
    poly([[22, 270], [28, 246], [38, 240], [42, 270]], '#ff9be0', 3);
});

scene('Moon', 'Moon', () => {
    sky('#141634');
    stars(11, 50, 230, ['#ffffff', '#fff3a8'], (x, y) => Math.hypot(x - 372, y - 82) < 52);
    // a far-away planet (blue and green, original shapes)
    circle(372, 82, 40, '#4aa8f0', 3);
    shape(smoothClosed([[350, 60], [372, 54], [380, 70], [366, 84], [354, 96], [344, 80]]), '#6cc35a');
    shape(smoothClosed([[388, 96], [404, 88], [406, 104], [392, 114], [382, 106]]), '#6cc35a');
    ellipse(388, 58, 12, 4, '#ffffff');
    shape(hills([[-10, 228], [100, 212], [200, 224], [320, 206], [490, 222]]), '#8c8ca6');
    shape(hills([[-10, 256], [110, 248], [240, 258], [360, 246], [490, 254]]), '#c9c9d8');
    for (const [x, y, rx, ry] of [[70, 286, 40, 11], [400, 284, 46, 12], [220, 334, 52, 13], [420, 340, 24, 7], [40, 340, 22, 6], [300, 286, 18, 5]]) {
        ellipse(x, y, rx, ry, '#a9a9bd');
        ellipse(x, y + ry * 0.3, rx * 0.82, ry * 0.62, '#94949f');
    }
    shape(smoothClosed([[150, 266], [158, 252], [176, 250], [186, 262], [182, 270]]), '#b1b1c4', 3);
    // flag
    inkLine(d().M(440, 270).L(440, 200), '#e8e8f0', 3, 1.5);
    poly([[442, 202], [474, 208], [442, 222]], '#ff6b6b', 2.5);
    poly(starPts(452, 211, 4, 1.8), '#ffffff');
});

scene('Forest', 'Forest', () => {
    sky('#d8f2e6');
    cloud(240, 44, 0.7, '#ffffff');
    // far row of trees (flat)
    for (let x = -20; x < W + 20; x += 34) {
        const h = 70 + ((x * 37) % 30);
        poly([[x - 22, 236], [x, 236 - h], [x + 22, 236]], '#9fd3a8');
    }
    shape(hills([[-10, 238], [140, 230], [300, 240], [490, 232]]), '#6bbf59');
    // mid trees
    pine(110, 244, 1.1, '#3f9a5a');
    pine(160, 240, 0.8, '#4fae6a');
    pine(330, 240, 0.85, '#4fae6a');
    pine(374, 244, 1.15, '#3f9a5a');
    // path
    shape(d().M(170, 364).C(200, 310, 236, 270, 232, 240).L(250, 240).C(262, 272, 290, 320, 318, 364).Z(), '#d9b47e');
    // big foreground trunks cut by the frame
    shape(d().M(-6, 364).L(-6, -6).L(46, -6).C(42, 120, 40, 240, 50, 300).C(56, 330, 68, 350, 74, 364).Z(), '#8a5a36', 3);
    line(d().M(14, 60).C(18, 90, 16, 120, 20, 150).M(28, 200).C(30, 230, 30, 250, 34, 280), '#6b4228', 3);
    shape(d().M(486, 364).L(486, -6).L(438, -6).C(442, 120, 446, 240, 436, 300).C(430, 330, 418, 350, 412, 364).Z(), '#8a5a36', 3);
    line(d().M(466, 80).C(462, 110, 464, 140, 460, 170).M(454, 220).C(452, 250, 452, 270, 448, 296), '#6b4228', 3);
    shape(smoothClosed(scallop(30, 6, 90, 50, 8, 0.12, 0)), '#4f9a52', 3);
    shape(smoothClosed(scallop(460, 0, 96, 54, 8, 0.12, 10)), '#3f8a4a', 3);
    // mushrooms, log, ferns
    const mush = (x, gy, s) => {
        rect(x - 5 * s, gy - 16 * s, 10 * s, 16 * s, '#fff3dc', 2.5);
        shape(arc(d().M(x - 18 * s, gy - 14 * s), x, gy - 14 * s, 18 * s, 16 * s, 180, 360).Z(), '#e8473c', 2.5);
        circle(x - 7 * s, gy - 22 * s, 3 * s, '#ffffff');
        circle(x + 6 * s, gy - 24 * s, 2.5 * s, '#ffffff');
    };
    mush(96, 300, 1.1);
    mush(118, 310, 0.8);
    mush(380, 330, 1);
    shape(roundRect(330, 270, 90, 26, 13), '#a86a3e', 3);
    ellipse(410, 283, 9, 13, '#e3b88a', 3);
    ellipse(410, 283, 4, 6, '#c9925a');
    for (const [x, y, dir] of [[150, 360, -1], [80, 360, 1], [430, 362, -1]]) {
        shape(leafPath(x, y, x + dir * 40, y - 46, 9, dir * 6), '#4fae4a', 2.5);
        shape(leafPath(x, y, x + dir * 6, y - 56, 8, 0), '#5cc46a', 2.5);
    }
});

scene('Snow', 'Snow', () => {
    sky('#d8e9ff');
    poly([[-10, 200], [70, 110], [140, 190], [210, 120], [300, 200]], '#b3c6e6');
    poly([[200, 200], [300, 100], [380, 180], [440, 130], [500, 200]], '#a3b8de');
    poly([[52, 130], [70, 110], [88, 128], [78, 124], [70, 132], [62, 124]], '#ffffff');
    poly([[194, 136], [210, 120], [226, 136], [216, 132], [210, 140], [202, 132]], '#ffffff');
    poly([[278, 122], [300, 100], [322, 122], [310, 118], [300, 128], [290, 118]], '#ffffff');
    shape(hills([[-10, 222], [100, 204], [230, 220], [360, 200], [490, 214]]), '#eaf2ff');
    shape(hills([[-10, 252], [130, 242], [270, 252], [400, 240], [490, 248]]), '#ffffff');
    line(d().M(20, 292).C(60, 286, 100, 290, 130, 296).M(300, 320).C(340, 312, 380, 314, 420, 322), '#d6e4f7', 4);
    pine(48, 248, 1.0, '#3f8a5a', true);
    pine(90, 240, 0.7, '#4f9a6a', true);
    pine(404, 244, 0.8, '#4f9a6a', true);
    pine(446, 252, 1.1, '#3f8a5a', true);
    // snowman
    circle(360, 302, 30, '#ffffff', 3);
    circle(360, 256, 22, '#ffffff', 3);
    circle(360, 220, 16, '#ffffff', 3);
    shape(d().M(344, 234).C(352, 240, 368, 240, 376, 234).L(378, 240).C(368, 246, 352, 246, 342, 240).Z(), '#e8473c', 2.5);
    poly([[368, 236], [380, 236], [384, 262], [372, 262]], '#e8473c', 2.5);
    poly([[360, 222], [378, 226], [360, 228]], '#ff8c42', 2);
    circle(354, 215, 2.4, INK);
    circle(366, 215, 2.4, INK);
    circle(360, 252, 2.8, INK);
    circle(360, 264, 2.8, INK);
    rect(346, 196, 28, 12, INK);
    rect(340, 206, 40, 5, INK);
    line(d().M(338, 252).L(312, 236).L(304, 238).M(312, 236).L(308, 228), '#8a5a36', 3);
    line(d().M(382, 252).L(408, 238).L(414, 230).M(408, 238).L(416, 240), '#8a5a36', 3);
    // falling snow
    const r = rng(23);
    for (let i = 0; i < 34; i++) {
        const x = r() * W;
        const y = r() * 230;
        circle(x, y, 2 + r() * 2.5, '#ffffff', ['#c7d8f0', 1]);
    }
});

scene('Desert', 'Desert', () => {
    bands([[-4, '#ffe8bd'], [120, '#ffdca6']]);
    sun(372, 70, 34);
    // mesas
    poly([[20, 218], [34, 150], [126, 150], [140, 218]], '#e3966a');
    poly([[34, 150], [126, 150], [122, 160], [38, 160]], '#cf7f56');
    poly([[300, 214], [312, 170], [380, 170], [392, 214]], '#e8a477');
    shape(hills([[-10, 220], [100, 210], [220, 222], [340, 206], [490, 218]]), '#f3c27a');
    shape(hills([[-10, 252], [130, 242], [270, 254], [400, 240], [490, 250]]), '#f8d38e');
    line(d().M(40, 290).C(80, 282, 120, 284, 150, 292).M(300, 310).C(340, 300, 390, 302, 430, 312)
        .M(170, 340).C(200, 334, 230, 334, 260, 342), '#ebbd70', 3);
    // saguaro cacti
    const cactus = (x, gy, s) => {
        const c = '#5fae5a';
        shape(d().M(x - 22 * s, gy - 60 * s).L(x - 22 * s, gy - 80 * s).C(x - 22 * s, gy - 88 * s, x - 34 * s, gy - 88 * s, x - 34 * s, gy - 80 * s)
            .L(x - 34 * s, gy - 56 * s).C(x - 34 * s, gy - 46 * s, x - 28 * s, gy - 42 * s, x - 18 * s, gy - 42 * s).L(x - 6 * s, gy - 42 * s)
            .L(x - 6 * s, gy - 60 * s).Z(), c, 3);
        shape(d().M(x + 6 * s, gy - 70 * s).L(x + 20 * s, gy - 70 * s).L(x + 20 * s, gy - 100 * s)
            .C(x + 20 * s, gy - 108 * s, x + 32 * s, gy - 108 * s, x + 32 * s, gy - 100 * s).L(x + 32 * s, gy - 70 * s)
            .C(x + 32 * s, gy - 60 * s, x + 26 * s, gy - 54 * s, x + 16 * s, gy - 54 * s).L(x + 6 * s, gy - 54 * s).Z(), c, 3);
        shape(d().M(x - 12 * s, gy).L(x - 12 * s, gy - 118 * s).C(x - 12 * s, gy - 134 * s, x + 12 * s, gy - 134 * s, x + 12 * s, gy - 118 * s)
            .L(x + 12 * s, gy).Z(), c, 3);
        line(d().M(x - 3 * s, gy - 110 * s).L(x - 3 * s, gy - 10 * s).M(x + 4 * s, gy - 104 * s).L(x + 4 * s, gy - 16 * s), '#4a9448', 2.5);
    };
    cactus(64, 290, 1.15);
    cactus(420, 268, 0.9);
    // barrel cactus with a flower
    shape(smoothClosed([[330, 300], [324, 282], [334, 268], [350, 268], [360, 282], [354, 300]]), '#6cbf62', 3);
    line(d().M(342, 270).L(342, 298), '#4a9448', 2.5);
    circle(342, 266, 6, '#ff7aa8', 2.5);
    // rocks and a lizard-free horizon
    shape(smoothClosed([[150, 300], [158, 284], [180, 280], [196, 292], [192, 302]]), '#c98d65', 3);
    shape(smoothClosed([[250, 268], [256, 258], [272, 256], [280, 266], [276, 272]]), '#d9a07a', 2.5);
    bird(220, 110, 1.1);
});

scene('Jungle', 'Jungle', () => {
    sky('#cdeed2');
    // distant canopy
    shape(hills([[-10, 120], [60, 90], [140, 112], [220, 86], [300, 110], [380, 84], [490, 104]], 250), '#8fcf8c');
    for (let x = 30; x < W; x += 84) {
        rect(x, 150, 12, 100, '#a07a52');
    }
    shape(hills([[-10, 244], [120, 236], [260, 246], [380, 234], [490, 242]]), '#5aa84a');
    // river
    shape(d().M(180, 244).C(170, 262, 230, 270, 210, 290).C(190, 312, 120, 320, 110, 364).L(250, 364)
        .C(260, 330, 300, 312, 290, 290).C(280, 270, 236, 262, 250, 244).Z(), '#6fcde8');
    line(d().M(196, 300).L(214, 300).M(170, 334).L(196, 334).M(230, 266).L(242, 266), '#ffffff', 3);
    // side trunks
    shape(d().M(-6, 364).L(-6, -6).L(40, -6).C(36, 120, 36, 240, 44, 300).C(48, 330, 56, 350, 62, 364).Z(), '#8a5a36', 3);
    shape(d().M(486, 364).L(486, -6).L(446, -6).C(450, 120, 452, 240, 444, 300).C(440, 330, 430, 350, 424, 364).Z(), '#8a5a36', 3);
    // canopy along the top
    for (const [x, y, rx, ry, c] of [[30, 0, 80, 42, '#3f9a4a'], [140, -6, 80, 36, '#4fae4a'], [250, -10, 70, 32, '#3f9a4a'],
        [350, -6, 80, 38, '#4fae4a'], [460, 0, 80, 44, '#3f9a4a']]) {
        shape(smoothClosed(scallop(x, y, rx, ry, 9, 0.14, 0)), c, 3);
    }
    // hanging vines
    const vine = (x, len, sway) => {
        inkLine(smoothOpen([[x, 20], [x + sway, 20 + len * 0.4], [x - sway, 20 + len * 0.75], [x + sway * 0.4, 20 + len]]), '#4f9a3a', 4, 1.5);
        for (let i = 1; i <= 4; i++) {
            const y = 20 + len * i / 4.5;
            const side = i % 2 ? 1 : -1;
            shape(leafPath(x + (i % 2 ? sway * 0.3 : -sway * 0.3), y, x + side * 14, y + 8, 4.5), '#6cc35a', 1.5);
        }
    };
    vine(96, 120, 6);
    vine(178, 80, -5);
    vine(312, 100, 6);
    vine(392, 140, -6);
    // big leaves in the foreground corners
    for (const [x0, y0, x1, y1, w, b, c] of [[0, 364, 70, 260, 18, 10, '#3f9a4a'], [0, 364, 110, 300, 16, -8, '#5cc46a'],
        [40, 364, 150, 330, 13, 6, '#4fae4a'], [480, 364, 410, 262, 18, -10, '#3f9a4a'], [480, 364, 370, 304, 16, 8, '#5cc46a'],
        [440, 364, 330, 334, 13, -6, '#4fae4a']]) {
        shape(leafPath(x0, y0, x1, y1, w, b), c, 3);
        line(d().M(x0, y0).L(x0 + (x1 - x0) * 0.85, y0 + (y1 - y0) * 0.85), '#2f7a3a', 2);
    }
    // flowers
    for (const [x, y, c] of [[64, 120, '#ff5c7a'], [420, 150, '#ff9a3c'], [150, 40, '#ff5c7a']]) {
        for (let i = 0; i < 5; i++) {
            const a = (-90 + i * 72) * Math.PI / 180;
            ellipse(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 6, 6, c, 1.5);
        }
        circle(x, y, 3.5, '#ffd84d', 1.5);
    }
});

scene('Mountains', 'Mountains', () => {
    sky('#bfe3ff');
    cloud(120, 54, 0.8);
    cloud(400, 40, 0.6);
    // far range with snow caps
    poly([[-20, 220], [60, 110], [130, 190], [220, 70], [320, 190], [380, 120], [500, 220]], '#9fb4d8');
    poly([[42, 136], [60, 110], [78, 136], [70, 132], [62, 140], [52, 132]], '#ffffff');
    poly([[190, 112], [220, 70], [250, 112], [238, 106], [226, 118], [214, 106], [202, 116]], '#ffffff');
    poly([[364, 142], [380, 120], [396, 142], [388, 138], [380, 146], [372, 138]], '#ffffff');
    // nearer green slopes
    shape(hills([[-10, 210], [70, 178], [160, 214], [280, 184], [370, 210], [430, 176], [490, 196]]), '#7fbf72');
    // lake
    shape(d().M(150, 238).C(180, 226, 320, 226, 350, 238).C(330, 254, 170, 254, 150, 238).Z(), '#7fd0f0', ['#5ab0d8', 3]);
    line(d().M(200, 236).L(240, 236).M(270, 244).L(300, 244), '#ffffff', 3);
    // meadow (ground for characters)
    shape(d().M(-10, 364).L(-10, 236).C(40, 230, 100, 230, 150, 240).C(170, 254, 330, 254, 350, 240)
        .C(400, 230, 440, 230, 490, 236).L(490, 364).Z(), '#8fd36a');
    pine(30, 262, 1.1, '#3f8a5a');
    pine(76, 252, 0.8, '#4f9a6a');
    pine(420, 256, 0.9, '#4f9a6a');
    pine(458, 266, 1.15, '#3f8a5a');
    flower(150, 330, '#ffffff', 14, 3.5);
    flower(330, 340, '#ffd84d', 14, 3.5);
    flower(380, 312, '#ff7aa8', 14, 3.5);
    grassTuft(240, 300);
    grassTuft(110, 344);
    bird(300, 110);
});

scene('Castle', 'Castle', () => {
    sky('#d6e8ff');
    cloud(80, 60, 0.8);
    cloud(400, 50, 0.7);
    shape(hills([[-10, 226], [100, 206], [240, 196], [380, 206], [490, 222]]), '#a6d98a');
    const stone = '#ddd6ea';
    const roof = '#7c6bd6';
    // towers
    const tower = (x, y, w, gy) => {
        rect(x, y, w, gy - y, stone, 3);
        poly([[x - 6, y], [x + w / 2, y - w * 1.1], [x + w + 6, y]], roof, 3);
        inkLine(d().M(x + w / 2, y - w * 1.1).L(x + w / 2, y - w * 1.1 - 22), '#8a8aa0', 1.5, 1);
        poly([[x + w / 2 + 1, y - w * 1.1 - 22], [x + w / 2 + 18, y - w * 1.1 - 17], [x + w / 2 + 1, y - w * 1.1 - 12]], '#ff6b6b', 2);
        rect(x + w / 2 - 5, y + 18, 10, 16, '#5a5a78', 2);
    };
    // wall with battlements
    rect(176, 130, 128, 90, stone, 3);
    for (let x = 176; x < 300; x += 22) {
        rect(x, 120, 13, 12, stone, 3);
    }
    tower(144, 110, 38, 220);
    tower(298, 110, 38, 220);
    tower(222, 74, 36, 132);
    // gate
    shape(d().M(222, 220).L(222, 186).C(222, 168, 258, 168, 258, 186).L(258, 220).Z(), '#6b4a3a', 3);
    line(d().M(234, 176).L(234, 220).M(246, 176).L(246, 220), '#4a3228', 2.5);
    rect(200, 150, 10, 16, '#5a5a78', 2);
    rect(270, 150, 10, 16, '#5a5a78', 2);
    // stones
    line(d().M(186, 196).L(200, 196).M(276, 204).L(292, 204).M(190, 146).L(180, 146), '#b8aecb', 2.5);
    // ground and path to the gate
    shape(hills([[-10, 222], [120, 222], [240, 220], [360, 222], [490, 222]]), '#8fd36a');
    shape(d().M(226, 220).L(254, 220).C(270, 270, 300, 320, 330, 364).L(170, 364).C(200, 320, 216, 270, 226, 220).Z(), '#e3d3a8');
    tree(40, 270, 1.05);
    tree(444, 266, 0.95, '#6cc35a', '#97dd7f');
    bush(110, 254, 60, 32, '#4fae4a');
    bush(380, 252, 54, 28, '#5bb84f');
    flower(90, 330, '#ff7aa8', 16, 4);
    flower(400, 340, '#ffd84d', 16, 4);
    grassTuft(340, 296);
    grassTuft(140, 300);
});

scene('Classroom', 'Classroom', () => {
    sky('#fbe7c2');
    rect(-4, 250, W + 8, 120, '#d9a66b');
    for (const y of [272, 298, 328]) {
        line(d().M(-4, y).L(W + 4, y), '#c48f55', 2.5);
    }
    line(d().M(90, 250).L(80, 272).M(250, 272).L(246, 298).M(380, 298).L(388, 328).M(140, 328).L(130, 364), '#c48f55', 2.5);
    rect(-4, 242, W + 8, 10, '#a8764a', 2.5);
    // chalkboard
    rect(118, 40, 244, 132, '#b5743e', 3);
    rect(128, 50, 224, 112, '#3f7a5a', 2.5);
    rect(150, 170, 180, 7, '#b5743e', 2.5);
    rect(170, 164, 14, 5, '#ffffff', 1.5);
    rect(196, 164, 10, 5, '#ffd84d', 1.5);
    // chalk drawings: A B C, a sun, a house, 1 2 3 dots
    const chalk = '#f2f2e6';
    line(d().M(146, 104).L(156, 72).L(166, 104).M(150, 94).L(162, 94), chalk, 3);
    line(d().M(176, 72).L(176, 104).M(176, 72).C(196, 72, 196, 88, 176, 88).M(176, 88).C(200, 88, 200, 104, 176, 104), chalk, 3);
    line(d().M(228, 76).C(214, 68, 204, 80, 206, 90).C(208, 104, 222, 106, 230, 98), chalk, 3);
    circle(280, 82, 10, '#3f7a5a', [chalk, 3]);
    line(d().M(280, 64).L(280, 58).M(280, 100).L(280, 106).M(262, 82).L(256, 82).M(298, 82).L(304, 82)
        .M(267, 69).L(263, 65).M(293, 95).L(297, 99).M(293, 69).L(297, 65).M(267, 95).L(263, 99), chalk, 2.5);
    line(d().M(312, 146).L(312, 124).L(326, 110).L(340, 124).L(340, 146).Z(), '#ffd84d', 3);
    for (let i = 0; i < 5; i++) {
        circle(152 + i * 18, 136, 4, chalk);
    }
    // clock
    circle(66, 70, 26, '#ffffff', 3);
    line(d().M(66, 70).L(66, 54).M(66, 70).L(78, 76), INK, 3);
    circle(66, 70, 2.5, INK);
    // window
    window4(404, 52, 56, 80, '#bfe8ff', '#ffffff');
    ellipse(424, 72, 10, 6, '#ffffff');
    // bookshelf
    rect(18, 152, 70, 92, '#b5743e', 3);
    rect(18, 194, 70, 6, '#9a5f30', 2);
    const books = [['#ff6b6b', 10], ['#4aa8f0', 8], ['#ffd84d', 12], ['#6cc35a', 9], ['#9b7bff', 10]];
    let bx = 24;
    for (const [c, w] of books) {
        rect(bx, 164 - (w % 3) * 2, w, 30 + (w % 3) * 2, c, 2);
        bx += w + 2;
    }
    rect(26, 214, 24, 24, '#ffd84d', 2.5);
    rect(54, 222, 22, 16, '#ff8c6b', 2.5);
    // alphabet blocks and a desk
    rect(398, 192, 70, 8, '#c98d55', 3);
    rect(404, 200, 7, 50, '#9a6a3f', 2.5);
    rect(455, 200, 7, 50, '#9a6a3f', 2.5);
    poly([[420, 192], [420, 178], [446, 178], [446, 192]], '#4aa8f0', 2.5);
    rect(60, 300, 26, 26, '#ff6b6b', 3);
    rect(90, 306, 20, 20, '#6cc35a', 3);
    rect(70, 278, 20, 22, '#ffd84d', 3);
});

scene('Bedroom', 'Bedroom', () => {
    sky('#d6e6ff');
    for (let x = 20; x < W; x += 40) {
        for (let y = 20; y < 240; y += 40) {
            poly(starPts(x + ((y / 40) % 2) * 20, y, 5, 2.2), '#c2d6f5');
        }
    }
    rect(-4, 246, W + 8, 120, '#e3b88a');
    for (const y of [272, 304, 340]) {
        line(d().M(-4, y).L(W + 4, y), '#cf9f6c', 2.5);
    }
    rect(-4, 238, W + 8, 10, '#ffffff', 2.5);
    // window with a day sky
    window4(56, 52, 84, 92, '#9fdcff', '#ffffff');
    cloud(84, 80, 0.4);
    circle(118, 118, 10, '#ffd84d');
    shape(d().M(40, 40).L(70, 40).C(64, 90, 60, 130, 50, 160).L(40, 160).Z(), '#ff9ab6', 2.5);
    shape(d().M(156, 40).L(126, 40).C(132, 90, 136, 130, 146, 160).L(156, 160).Z(), '#ff9ab6', 2.5);
    rect(34, 34, 128, 8, '#c98d55', 2.5);
    // bed on the right
    shape(d().M(328, 284).L(328, 176).C(328, 150, 384, 150, 384, 176).L(384, 284).Z(), '#c98d55', 3);
    shape(d().M(338, 210).L(338, 182).C(338, 164, 374, 164, 374, 182).L(374, 210).Z(), '#b5743e', 2.5);
    rect(462, 214, 16, 70, '#c98d55', 3);
    rect(334, 222, 140, 34, '#ffffff', 3);
    rect(334, 256, 140, 14, '#b5743e', 3);
    shape(roundRect(342, 200, 48, 26, 11), '#ffffff', 3);
    shape(d().M(380, 214).L(472, 214).L(472, 266).C(440, 272, 410, 272, 380, 266).Z(), '#6fb7ff', 3);
    for (const [x, y] of [[400, 230], [430, 244], [456, 228], [404, 254], [452, 256]]) {
        poly(starPts(x, y, 6, 2.6), '#ffd84d');
    }
    // rug in the middle of the floor
    ellipse(230, 314, 120, 26, '#ffcf6b', 3);
    ellipse(230, 314, 92, 18, '#ff9a6b');
    // nightstand and lamp
    rect(262, 188, 50, 58, '#c98d55', 3);
    rect(270, 206, 34, 8, '#9a6a3f', 2);
    rect(282, 168, 10, 20, '#9a9ab0', 2.5);
    poly([[270, 168], [276, 140], [298, 140], [304, 168]], '#ffd84d', 3);
    // shelf with toys
    rect(190, 108, 90, 8, '#c98d55', 3);
    rect(198, 84, 22, 24, '#ff6b6b', 2.5);
    circle(244, 98, 10, '#6cc35a', 2.5);
    poly([[258, 108], [268, 84], [278, 108]], '#9b7bff', 2.5);
    // a ball and a toy box on the floor
    circle(80, 300, 18, '#ff6b6b', 3);
    line(d().M(62, 300).C(72, 292, 88, 292, 98, 300), '#ffffff', 4);
    rect(20, 250, 50, 40, '#4aa8f0', 3);
    rect(16, 244, 58, 10, '#2f8ad8', 3);
});

scene('Kitchen', 'Kitchen', () => {
    sky('#fff1d0');
    // floor tiles
    rect(-4, 262, W + 8, 110, '#f4f4f4');
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 13; col++) {
            if ((row + col) % 2 === 0) {
                rect(col * 40 - 10, 262 + row * 34, 40, 34, '#9fd6d2');
            }
        }
    }
    // tiled backsplash
    rect(-4, 140, W + 8, 60, '#ffffff');
    for (let x = 0; x <= W; x += 24) {
        line(d().M(x, 140).L(x, 200), '#e2e6ee', 1.5);
    }
    for (let y = 152; y < 200; y += 12) {
        line(d().M(0, y).L(W, y), '#e2e6ee', 1.5);
    }
    // window
    window4(180, 46, 96, 70, '#bfe8ff', '#ffffff');
    circle(250, 70, 9, '#ffd84d');
    // upper cabinets
    rect(20, 30, 130, 84, '#7fc8a9', 3);
    line(d().M(85, 30).L(85, 114), INK, 3);
    rect(72, 66, 4, 14, INK);
    rect(94, 66, 4, 14, INK);
    // counter and cabinets
    rect(-4, 200, 376, 64, '#7fc8a9', 3);
    rect(-6, 192, 380, 12, '#f2d7a6', 3);
    for (let x = 14; x < 360; x += 70) {
        rect(x, 214, 56, 40, '#93d4b8', 2.5);
        rect(x + 24, 220, 8, 4, INK);
    }
    // stove top and a pot
    rect(36, 186, 70, 6, '#5a5f70', 2);
    shape(d().M(46, 186).L(46, 162).L(96, 162).L(96, 186).Z(), '#ff8c6b', 3);
    rect(40, 156, 62, 8, '#ff6b6b', 2.5);
    line(d().M(64, 154).L(78, 154), INK, 4);
    // fruit bowl
    shape(d().M(220, 178).C(220, 196, 276, 196, 276, 178).Z(), '#4aa8f0', 3);
    circle(238, 172, 9, '#ff6b6b', 2.5);
    circle(256, 170, 9, '#ffb84d', 2.5);
    circle(248, 162, 8, '#9fd34a', 2.5);
    // fridge
    shape(roundRect(384, 64, 86, 200, 10), '#e8f1ff', 3);
    line(d().M(384, 136).L(470, 136), INK, 3);
    rect(392, 104, 5, 22, '#9aa2b4', 2);
    rect(392, 146, 5, 30, '#9aa2b4', 2);
    circle(440, 90, 6, '#ff6b6b', 2);
    rect(424, 160, 22, 26, '#ffd84d', 2);
});

scene('Playground', 'Playground', () => {
    sky('#bfe6ff');
    sun(70, 58, 26);
    cloud(260, 50, 0.85);
    cloud(420, 76, 0.6);
    shape(hills([[-10, 214], [120, 198], [260, 210], [380, 194], [490, 208]]), '#acdd8c');
    tree(250, 214, 0.55, '#86c77a', '#a6d98f');
    tree(290, 210, 0.45, '#86c77a', '#a6d98f');
    shape(hills([[-10, 244], [120, 238], [260, 246], [380, 236], [490, 242]]), '#7cc95a');
    // swing set
    const metal = '#ff6b6b';
    inkLine(d().M(20, 268).L(48, 130).L(76, 268), metal, 5, 2);
    inkLine(d().M(160, 266).L(188, 130).L(216, 266), metal, 5, 2);
    inkLine(d().M(40, 130).L(196, 130), '#ffb84d', 7, 2);
    for (const x of [90, 140]) {
        line(d().M(x - 12, 132).L(x - 12, 226).M(x + 12, 132).L(x + 12, 226), INK, 2.5);
        rect(x - 18, 224, 36, 8, '#4aa8f0', 2.5);
    }
    // slide
    inkLine(d().M(348, 270).L(348, 150).M(396, 270).L(396, 150), '#4aa8f0', 5, 2);
    for (let y = 170; y < 270; y += 22) {
        line(d().M(348, y).L(396, y), INK, 3);
    }
    rect(340, 142, 62, 12, '#ffd84d', 3);
    shape(d().M(400, 142).L(414, 142).C(430, 200, 456, 250, 478, 256).L(484, 270).L(470, 272)
        .C(444, 260, 418, 210, 400, 154).Z(), '#ffb84d', 3);
    inkLine(d().M(342, 142).L(342, 120).L(400, 120).L(400, 142), '#4aa8f0', 3, 1.5);
    // sandbox
    rect(20, 300, 120, 44, '#f6dc9c', 3);
    rect(14, 294, 132, 10, '#c98d55', 3);
    rect(14, 340, 132, 10, '#c98d55', 3);
    shape(arc(d().M(56, 334), 74, 334, 18, 14, 180, 360).Z(), '#f2c870', 2.5);
    poly([[100, 322], [112, 322], [114, 336], [98, 336]], '#ff6b6b', 2.5);
    line(d().M(114, 314).L(124, 300), '#4aa8f0', 3);
    // ball
    circle(300, 330, 14, '#9b7bff', 3);
    line(d().M(287, 326).C(296, 320, 306, 320, 313, 326), '#ffffff', 3);
    grassTuft(240, 290);
    grassTuft(420, 330);
    flower(460, 340, '#ff7aa8', 16, 4);
});

scene('NightSky', 'Night Sky', () => {
    bands([[-4, '#1b2556'], [110, '#22306a'], [180, '#2b3c7c']]);
    stars(31, 60, 210, ['#ffffff', '#fff3a8', '#cfe0ff'], (x, y) => Math.hypot(x - 382, y - 76) < 50);
    sparkle(120, 50, 8);
    sparkle(250, 110, 6, '#fff3a8');
    // moon
    circle(382, 76, 50, '#2b3c7c');
    circle(382, 76, 36, '#fff4c2', ['#f2d98a', 3]);
    circle(370, 66, 7, '#f2e0a0');
    circle(394, 88, 5, '#f2e0a0');
    circle(388, 62, 3.5, '#f2e0a0');
    // shooting star
    line(d().M(160, 150).L(220, 126), '#cfe0ff', 3);
    poly(starPts(226, 124, 8, 3.5), '#fff3a8', 2);
    shape(hills([[-10, 224], [90, 204], [200, 222], [320, 200], [490, 220]]), '#24406e');
    // houses with lit windows
    const house = (x, gy, w, h, c) => {
        rect(x, gy - h, w, h, c, 3);
        poly([[x - 6, gy - h], [x + w / 2, gy - h - w * 0.5], [x + w + 6, gy - h]], '#3a2f5c', 3);
        rect(x + w * 0.2, gy - h + 12, w * 0.24, 14, '#ffd84d', 2);
        rect(x + w * 0.56, gy - h + 12, w * 0.24, 14, '#ffd84d', 2);
        rect(x + w * 0.38, gy - 20, w * 0.24, 20, '#2a2238', 2);
    };
    house(24, 246, 60, 44, '#4a5a8c');
    house(96, 242, 46, 36, '#5a4a7c');
    house(368, 244, 54, 42, '#4a5a8c');
    shape(hills([[-10, 244], [120, 238], [260, 246], [380, 236], [490, 242]]), '#2f5a4a');
    pine(440, 248, 0.9, '#1f4a3a');
    pine(176, 244, 0.7, '#1f4a3a');
    // fireflies
    for (const [x, y] of [[230, 280], [300, 300], [120, 316], [400, 320], [60, 290], [340, 262]]) {
        circle(x, y, 5, '#5a7a3a');
        circle(x, y, 2.5, '#fff38a');
    }
    grassTuft(260, 340, '#244a3a');
    grassTuft(40, 344, '#244a3a');
});

scene('Stage', 'Stage', () => {
    sky('#3b2f63');
    // spotlight beams on the backdrop
    poly([[110, -4], [150, -4], [250, 262], [130, 262]], '#4c3f7a');
    poly([[330, -4], [370, -4], [350, 262], [230, 262]], '#4c3f7a');
    for (const [x, y, s] of [[200, 90, 8], [280, 70, 6], [240, 150, 7], [160, 170, 5], [320, 160, 6]]) {
        poly(starPts(x, y, s, s * 0.45), '#ffd84d');
    }
    // stage floor
    rect(-4, 256, W + 8, 72, '#c98b4f', 3);
    for (const y of [274, 292, 310]) {
        line(d().M(-4, y).L(W + 4, y), '#ad7440', 2);
    }
    rect(-4, 326, W + 8, 40, '#7a4a2a', 3);
    ellipse(240, 296, 120, 22, '#e0a868');
    // footlights
    for (let x = 40; x < W; x += 50) {
        shape(arc(d().M(x - 12, 328), x, 328, 12, 10, 180, 360).Z(), '#fff1a8', 2.5);
    }
    // side curtains with folds
    const curtain = (x0, x1, dir) => {
        const inner = dir > 0 ? x1 : x0;
        const outer = dir > 0 ? x0 : x1;
        shape(d().M(outer, -6).L(inner, -6).C(inner - dir * 6, 100, inner - dir * 30, 200, inner - dir * 4, 264)
            .C(inner - dir * 20, 270, inner - dir * 40, 270, outer, 268).Z(), '#c8323c', 3);
        for (let i = 1; i <= 3; i++) {
            const x = outer + (inner - outer) * i / 4;
            line(d().M(x, 30).C(x - dir * 4, 120, x - dir * 18, 200, x - dir * 8, 262), '#9a2430', 3);
        }
        circle(inner - dir * 18, 176, 6, '#ffcf4d', 2.5);
    };
    curtain(-6, 96, 1);
    curtain(384, 486, -1);
    // top valance with scallops
    const top = d().M(-6, -6).L(486, -6).L(486, 34);
    for (let x = 486; x > -6; x -= 41) {
        top.C(x - 6, 54, x - 35, 54, x - 41, 34);
    }
    shape(top.Z(), '#a8242f', 3);
    line(d().M(-6, 30).L(486, 30), '#ffcf4d', 4);
    for (let x = 486 - 20.5; x > 0; x -= 41) {
        circle(x, 48, 4, '#ffcf4d', 1.5);
    }
});

scene('Garden', 'Garden', () => {
    sky('#c9ecff');
    sun(410, 56, 26);
    cloud(150, 54, 0.8);
    shape(hills([[-10, 214], [120, 202], [260, 212], [380, 198], [490, 210]]), '#acdd8c');
    picketFence(-6, 486, 238, 52);
    shape(hills([[-10, 236], [140, 232], [300, 238], [490, 232]]), '#7cc95a');
    // sunflowers along the fence
    for (const [x, h] of [[30, 120], [62, 96]]) {
        line(d().M(x, 240).L(x, 240 - h), '#3f9a4a', 5);
        shape(leafPath(x, 240 - h * 0.4, x + 22, 240 - h * 0.5, 7), '#4fae4a', 2);
        shape(smoothClosed(scallop(x, 240 - h, 20, 20, 10, 0.25)), '#ffd84d', 2.5);
        circle(x, 240 - h, 9, '#8a5a36', 2.5);
    }
    // vegetable beds
    rect(330, 262, 140, 40, '#9a6a3f', 3);
    rect(336, 266, 128, 32, '#7a4a2a');
    for (let x = 350; x < 460; x += 26) {
        shape(leafPath(x, 272, x - 6, 254, 4), '#5cc46a', 2);
        shape(leafPath(x, 272, x + 6, 254, 4), '#4fae4a', 2);
        poly([[x - 4, 272], [x + 4, 272], [x, 284]], '#ff8c42', 2);
    }
    for (const x of [356, 396, 436]) {
        shape(smoothClosed(scallop(x, 322, 15, 12, 9, 0.12)), '#9fd34a', 2.5);
        line(d().M(x - 6, 318).C(x - 2, 324, x + 2, 324, x + 6, 318), '#6fae2a', 2);
    }
    rect(330, 304, 140, 6, '#9a6a3f', 2);
    // flower bed on the left
    bush(100, 274, 70, 22, '#4fae4a', 2.5);
    flower(80, 272, '#ff7aa8', 26);
    flower(104, 268, '#9b7bff', 30);
    flower(126, 274, '#ff6b6b', 24);
    // stepping stones
    for (const [x, y, rx] of [[226, 270, 16], [246, 296, 18], [228, 326, 20]]) {
        ellipse(x, y, rx, rx * 0.4, '#c7c7d1', 2.5);
    }
    // watering can
    shape(d().M(30, 340).L(34, 304).L(74, 304).L(78, 340).Z(), '#4aa8f0', 3);
    line(d().M(74, 316).L(96, 298), INK, 7);
    line(d().M(74, 316).L(96, 298), '#4aa8f0', 3);
    line(d().M(38, 304).C(40, 288, 68, 288, 70, 304), INK, 3);
    // birdhouse on a pole
    inkLine(d().M(170, 262).L(170, 196), '#9a6a3f', 4, 2);
    rect(156, 176, 28, 24, '#ff8c6b', 3);
    poly([[150, 178], [170, 160], [190, 178]], '#c8323c', 3);
    circle(170, 188, 4, INK);
    butterfly(290, 150, '#ff9ab6');
    butterfly(140, 110, '#ffd84d');
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function render (name) {
    const body = shapes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${W}px" height="${H}px" viewBox="0 0 ${W} ${H}">\n` +
        `<g id="${name}.svg">\n${body}\n</g>\n</svg>\n`;
}

const meta = [];
for (const {name, title, draw} of scenes) {
    shapes = [];
    draw();
    const svg = render(name);
    fs.writeFileSync(path.join(outDir, `${name}.svg`), svg);
    meta.push({md5: `${name}.svg`, width: W, height: H, ext: 'svg', name: title});
    console.log(`${name}.svg  ${shapes.length} shapes  ${(svg.length / 1024).toFixed(1)} KB`);
}
fs.writeFileSync(path.join(outDir, 'backgrounds.json'), JSON.stringify(meta, null, 4) + '\n');
console.log(`wrote ${meta.length} backgrounds`);
