// Converts ordinary SVG art into the subset ScratchJr's paint editor can edit:
//   - every shape becomes a <path> with absolute M/L/C/Z commands only
//   - group styles (fill/stroke/opacity) and transforms are pushed down and applied
//   - circles/ellipses/rects/polygons are converted to cubic paths
//   - arcs, quadratics and shorthand curves are converted to cubics
// Files using clipPath/mask/gradients/<use> are rejected (returned as null).
//
// Library use: import {convertSvg} from './svg-to-sjr.mjs'
//   convertSvg(svgText, {height, id, minStrokeWidth}) -> {svg, width, height} | null

const K = 0.5522847498; // cubic approximation of a quarter circle

// ---------- affine matrices: [a, b, c, d, e, f] ----------
const IDENTITY = [1, 0, 0, 1, 0, 0];
function mul (m, n) {
    return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
}
function apply (m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function parseTransform (str) {
    let m = IDENTITY;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let t;
    while ((t = re.exec(str || ''))) {
        const v = t[2].trim().split(/[\s,]+/).map(Number);
        let n;
        switch (t[1]) {
        case 'matrix':
            n = v;
            break;
        case 'translate':
            n = [1, 0, 0, 1, v[0], v[1] || 0];
            break;
        case 'scale':
            n = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0];
            break;
        case 'rotate': {
            const r = v[0] * Math.PI / 180;
            const cos = Math.cos(r);
            const sin = Math.sin(r);
            n = [cos, sin, -sin, cos, 0, 0];
            if (v.length > 2) {
                n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
            }
            break;
        }
        case 'skewX':
            n = [1, 0, Math.tan(v[0] * Math.PI / 180), 1, 0, 0];
            break;
        case 'skewY':
            n = [1, Math.tan(v[0] * Math.PI / 180), 0, 1, 0, 0];
            break;
        }
        m = mul(m, n);
    }
    return m;
}

// ---------- path parsing to absolute segments ----------
// Result: list of subpaths; each {start:[x,y], segs:[{type:'L'|'C', pts:[...]}], closed}
function arcToCubics (x1, y1, rx, ry, phi, large, sweep, x2, y2) {
    // SVG implementation notes F.6
    if (rx === 0 || ry === 0) {
        return [[x1, y1, x2, y2, x2, y2]];
    }
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const p = phi * Math.PI / 180;
    const cp = Math.cos(p);
    const sp = Math.sin(p);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cp * dx + sp * dy;
    const y1p = -sp * dx + cp * dy;
    let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) {
        rx *= Math.sqrt(lam);
        ry *= Math.sqrt(lam);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num / den));
    if (large === sweep) {
        co = -co;
    }
    const cxp = co * rx * y1p / ry;
    const cyp = -co * ry * x1p / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
    const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => {
        const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        return a;
    };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) {
        dt -= 2 * Math.PI;
    } else if (sweep && dt < 0) {
        dt += 2 * Math.PI;
    }
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
    const step = dt / n;
    const out = [];
    const pt = (t) => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
    const der = (t) => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
    for (let i = 0; i < n; i++) {
        const a = t1 + i * step;
        const b = a + step;
        const k = 4 / 3 * Math.tan(step / 4);
        const [ax, ay] = pt(a);
        const [bx, by] = pt(b);
        const [dax, day] = der(a);
        const [dbx, dby] = der(b);
        out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
    }
    return out;
}

function parsePath (d) {
    const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
    const subs = [];
    let cur = null;
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let lastC = null; // last cubic control point (for S)
    let lastQ = null; // last quadratic control point (for T)
    let i = 0;
    let cmd = null;
    const num = () => Number(tokens[i++]);
    const isNum = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i]);
    const cubic = (c1x, c1y, c2x, c2y, ex, ey) => {
        cur.segs.push({type: 'C', pts: [c1x, c1y, c2x, c2y, ex, ey]});
        x = ex;
        y = ey;
    };
    while (i < tokens.length) {
        if (/[A-Za-z]/.test(tokens[i])) {
            cmd = tokens[i++];
        } else if (cmd === null) {
            throw new Error('path data must start with a command');
        }
        const rel = cmd === cmd.toLowerCase();
        const ox = rel ? x : 0;
        const oy = rel ? y : 0;
        switch (cmd.toUpperCase()) {
        case 'M': {
            x = ox + num();
            y = oy + num();
            sx = x;
            sy = y;
            cur = {start: [x, y], segs: [], closed: false};
            subs.push(cur);
            lastC = lastQ = null;
            cmd = rel ? 'l' : 'L'; // implicit lineto after moveto
            break;
        }
        case 'L':
            x = ox + num();
            y = oy + num();
            cur.segs.push({type: 'L', pts: [x, y]});
            lastC = lastQ = null;
            break;
        case 'H':
            x = ox + num();
            cur.segs.push({type: 'L', pts: [x, y]});
            lastC = lastQ = null;
            break;
        case 'V':
            y = oy + num();
            cur.segs.push({type: 'L', pts: [x, y]});
            lastC = lastQ = null;
            break;
        case 'C': {
            const v = [num(), num(), num(), num(), num(), num()];
            lastC = [ox + v[2], oy + v[3]];
            cubic(ox + v[0], oy + v[1], ox + v[2], oy + v[3], ox + v[4], oy + v[5]);
            lastQ = null;
            break;
        }
        case 'S': {
            const v = [num(), num(), num(), num()];
            const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
            lastC = [ox + v[0], oy + v[1]];
            cubic(c1[0], c1[1], ox + v[0], oy + v[1], ox + v[2], oy + v[3]);
            lastQ = null;
            break;
        }
        case 'Q': {
            const v = [num(), num(), num(), num()];
            const qx = ox + v[0];
            const qy = oy + v[1];
            const ex = ox + v[2];
            const ey = oy + v[3];
            cubic(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey);
            lastQ = [qx, qy];
            lastC = null;
            break;
        }
        case 'T': {
            const ex = ox + num();
            const ey = oy + num();
            const q = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
            cubic(x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y), ex + 2 / 3 * (q[0] - ex), ey + 2 / 3 * (q[1] - ey), ex, ey);
            lastQ = q;
            lastC = null;
            break;
        }
        case 'A': {
            const rx = num();
            const ry = num();
            const rot = num();
            const large = num() ? 1 : 0;
            const sweep = num() ? 1 : 0;
            const ex = ox + num();
            const ey = oy + num();
            for (const c of arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey)) {
                cubic(...c);
            }
            lastC = lastQ = null;
            break;
        }
        case 'Z':
            if (cur) {
                cur.closed = true;
            }
            x = sx;
            y = sy;
            lastC = lastQ = null;
            // A path may continue after Z without a new M.
            cur = {start: [x, y], segs: [], closed: false};
            subs.push(cur);
            cmd = null;
            continue;
        }
        // Repeated coordinates reuse the previous command.
        if (!isNum()) {
            continue;
        }
    }
    return subs.filter((s) => s.segs.length > 0);
}

function ellipsePath (cx, cy, rx, ry) {
    const kx = rx * K;
    const ky = ry * K;
    return [{start: [cx + rx, cy], closed: true, segs: [
        {type: 'C', pts: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry]},
        {type: 'C', pts: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy]},
        {type: 'C', pts: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry]},
        {type: 'C', pts: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy]}
    ]}];
}

function rectPath (x, y, w, h, rx, ry) {
    if (!rx && !ry) {
        return [{start: [x, y], closed: true, segs: [
            {type: 'L', pts: [x + w, y]}, {type: 'L', pts: [x + w, y + h]}, {type: 'L', pts: [x, y + h]}, {type: 'L', pts: [x, y]}
        ]}];
    }
    rx = Math.min(rx || ry, w / 2);
    ry = Math.min(ry || rx, h / 2);
    const kx = rx * K;
    const ky = ry * K;
    return [{start: [x + rx, y], closed: true, segs: [
        {type: 'L', pts: [x + w - rx, y]},
        {type: 'C', pts: [x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry]},
        {type: 'L', pts: [x + w, y + h - ry]},
        {type: 'C', pts: [x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h]},
        {type: 'L', pts: [x + rx, y + h]},
        {type: 'C', pts: [x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry]},
        {type: 'L', pts: [x, y + ry]},
        {type: 'C', pts: [x, y + ry - ky, x + rx - kx, y, x + rx, y]}
    ]}];
}

function polyPath (points, closed) {
    const v = points.trim().split(/[\s,]+/).map(Number);
    const segs = [];
    for (let i = 2; i + 1 < v.length; i += 2) {
        segs.push({type: 'L', pts: [v[i], v[i + 1]]});
    }
    return [{start: [v[0], v[1]], segs, closed}];
}

// ---------- minimal XML walk ----------
function parseAttrs (s) {
    const a = {};
    const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(s))) {
        a[m[1]] = m[3] !== undefined ? m[3] : m[4];
    }
    // Inline style declarations override presentation attributes.
    if (a.style) {
        for (const decl of a.style.split(';')) {
            const [k, v] = decl.split(':').map((t) => t && t.trim());
            if (k && v) {
                a[k] = v;
            }
        }
    }
    return a;
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'fill-rule', 'opacity', 'fill-opacity'];

function normColor (c) {
    if (!c) {
        return c;
    }
    c = c.trim();
    if (/^#[0-9a-f]{3}$/i.test(c)) {
        return '#' + c.slice(1).split('').map((h) => h + h).join('').toLowerCase();
    }
    if (c === 'black') {
        return '#000000';
    }
    if (c === 'white') {
        return '#ffffff';
    }
    return c.toLowerCase();
}

// Blend a colour toward white for opacity (backgrounds are light; good enough for art).
function fadeColor (c, alpha) {
    const m = /^#([0-9a-f]{6})$/i.exec(c || '');
    if (!m || alpha >= 1) {
        return c;
    }
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * alpha + 255 * (1 - alpha)));
    return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function convertSvg (text, opts = {}) {
    if (/<(clipPath|mask|linearGradient|radialGradient|pattern|use|image|text|filter)\b/.test(text)) {
        return null;
    }
    const root = /<svg\b([^>]*)>/.exec(text);
    if (!root) {
        return null;
    }
    const rootAttrs = parseAttrs(root[1]);
    const vb = (rootAttrs.viewBox || `0 0 ${parseFloat(rootAttrs.width)} ${parseFloat(rootAttrs.height)}`).split(/[\s,]+/).map(Number);

    const shapes = [];
    const stack = [{style: {fill: '#000000', stroke: 'none', ...pick(rootAttrs)}, m: IDENTITY}];
    const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
    let t;
    while ((t = re.exec(text))) {
        const [, closing, tag, rest, selfClose] = t;
        if (tag === 'svg' || tag === 'title' || tag === 'desc' || tag === 'defs' || tag === 'metadata' || tag.includes(':')) {
            continue;
        }
        if (closing) {
            if (tag === 'g' && stack.length > 1) {
                stack.pop();
            }
            continue;
        }
        const attrs = parseAttrs(rest);
        const parent = stack[stack.length - 1];
        const style = {...parent.style, ...pick(attrs)};
        // opacity multiplies down the tree
        style.opacity = (parseFloat(parent.style.opacity) || 1) * (attrs.opacity !== undefined ? parseFloat(attrs.opacity) : 1);
        const m = attrs.transform ? mul(parent.m, parseTransform(attrs.transform)) : parent.m;
        if (tag === 'g') {
            if (!selfClose) {
                stack.push({style, m});
            }
            continue;
        }
        let subs = null;
        const n = (k) => parseFloat(attrs[k] || 0);
        switch (tag) {
        case 'path':
            subs = parsePath(attrs.d || '');
            break;
        case 'circle':
            subs = ellipsePath(n('cx'), n('cy'), n('r'), n('r'));
            break;
        case 'ellipse':
            subs = ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'));
            break;
        case 'rect':
            subs = rectPath(n('x'), n('y'), n('width'), n('height'), n('rx'), n('ry'));
            break;
        case 'polygon':
            subs = polyPath(attrs.points || '', true);
            break;
        case 'polyline':
            subs = polyPath(attrs.points || '', false);
            break;
        case 'line':
            subs = [{start: [n('x1'), n('y1')], segs: [{type: 'L', pts: [n('x2'), n('y2')]}], closed: false}];
            break;
        default:
            continue;
        }
        shapes.push({subs, style, m});
    }

    // Fit: scale the viewBox content to the requested height, then crop to the drawn bounds.
    const height = opts.height || vb[3];
    const s = height / vb[3];
    const fit = mul([s, 0, 0, s, 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const placed = shapes.map((sh) => {
        const mm = mul(fit, sh.m);
        const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
        const subs = sh.subs.map((sp) => {
            const start = apply(mm, ...sp.start);
            const segs = sp.segs.map((sg) => {
                const pts = [];
                for (let i = 0; i < sg.pts.length; i += 2) {
                    pts.push(...apply(mm, sg.pts[i], sg.pts[i + 1]));
                }
                return {type: sg.type, pts};
            });
            return {start, segs, closed: sp.closed};
        });
        for (const sp of subs) {
            for (const pts of [sp.start, ...sp.segs.map((sg) => sg.pts)]) {
                for (let i = 0; i < pts.length; i += 2) {
                    minX = Math.min(minX, pts[i]);
                    maxX = Math.max(maxX, pts[i]);
                    minY = Math.min(minY, pts[i + 1]);
                    maxY = Math.max(maxY, pts[i + 1]);
                }
            }
        }
        return {subs, style: sh.style, scale};
    });
    if (!placed.length) {
        return null;
    }
    const pad = 2;
    const ox = pad - minX;
    const oy = pad - minY;
    const r = (v) => Math.round(v * 100) / 100;
    const W = Math.ceil(maxX - minX + 2 * pad);
    const H = Math.ceil(maxY - minY + 2 * pad);

    const body = placed.map(({subs, style, scale}) => {
        const d = subs.map((sp) => {
            let out = `M${r(sp.start[0] + ox)},${r(sp.start[1] + oy)}`;
            for (const sg of sp.segs) {
                const p = [];
                for (let i = 0; i < sg.pts.length; i += 2) {
                    p.push(`${r(sg.pts[i] + ox)},${r(sg.pts[i + 1] + oy)}`);
                }
                out += sg.type + p.join(' ');
            }
            return out + (sp.closed ? 'Z' : '');
        }).join('');
        const alpha = (parseFloat(style.opacity) || 1) * (style['fill-opacity'] !== undefined ? parseFloat(style['fill-opacity']) : 1);
        const fill = style.fill === 'none' ? 'none' : fadeColor(normColor(style.fill), alpha);
        const stroke = !style.stroke || style.stroke === 'none' ? 'none' : fadeColor(normColor(style.stroke), alpha);
        const attrs = [`fill="${fill}"`, `stroke="${stroke}"`];
        if (stroke !== 'none') {
            const sw = Math.max(opts.minStrokeWidth || 0, r((parseFloat(style['stroke-width']) || 1) * scale));
            attrs.push(`stroke-width="${sw}"`,
                `stroke-linejoin="${style['stroke-linejoin'] || 'round'}"`,
                `stroke-linecap="${style['stroke-linecap'] || 'round'}"`);
        }
        if (style['fill-rule'] === 'evenodd') {
            attrs.push('fill-rule="evenodd"');
        }
        return `<path ${attrs.join(' ')} d="${d}"/>`;
    }).join('');
    const id = opts.id || 'art';
    return {
        width: W,
        height: H,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${W}px" height="${H}px" viewBox="0 0 ${W} ${H}">` +
            `<g id="${id}">${body}</g></svg>\n`
    };
}

function pick (attrs) {
    const o = {};
    for (const k of INHERITED) {
        if (attrs[k] !== undefined && k !== 'opacity') {
            o[k] = attrs[k];
        }
    }
    return o;
}
