// Checks SVG art against the subset that ScratchJr's paint editor can read.
//
// Usage: node desktop/open-art/tools/check-svg.mjs [options] <file-or-dir> [...]
//   --size WxH          also require width="Wpx" height="Hpx" viewBox="0 0 W H" and
//                       warn about coordinates more than 40 units outside it
//   --max-bytes N       fail files larger than N bytes (default 61440)
//   --max-elements N    fail files with more than N shapes (default 400)
//
// Rules enforced (any violation makes the run exit with code 1):
//   - only <svg>, one wrapping <g id="<file name>">, and <path> <circle> <ellipse>
//     <rect> <polygon>; nothing else (no defs, gradients, use, text, style, ...)
//   - no transform / style / class / opacity / filter / clip-path / mask / href
//   - every shape has fill="#rrggbb"|"none" and stroke="#rrggbb"|"none"; a
//     stroked shape also has stroke-width
//   - path data uses only absolute M, L, C, Z with the right number of values
import fs from 'node:fs';
import path from 'node:path';

const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon']);
const FORBIDDEN_ATTRS = new Set(['transform', 'style', 'class', 'opacity', 'fill-opacity', 'stroke-opacity', 'filter',
    'clip-path', 'mask', 'href', 'xlink:href', 'fill-rule', 'clip-rule', 'stroke-dasharray', 'marker-start', 'marker-mid', 'marker-end']);
const COLOUR = /^(#[0-9a-fA-F]{6}|none)$/;
const NUM = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const GEOMETRY = {
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    rect: ['x', 'y', 'width', 'height'],
    polygon: ['points'],
    path: ['d']
};
const ARGS = {M: 2, L: 2, C: 6, Z: 0};

const opts = {size: null, maxBytes: 61440, maxElements: 400};
const inputs = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--size') {
        const m = /^(\d+)x(\d+)$/.exec(argv[++i] || '');
        if (!m) {
            console.error('--size expects WxH, e.g. 480x360');
            process.exit(2);
        }
        opts.size = [Number(m[1]), Number(m[2])];
    } else if (a === '--max-bytes') {
        opts.maxBytes = Number(argv[++i]);
    } else if (a === '--max-elements') {
        opts.maxElements = Number(argv[++i]);
    } else {
        inputs.push(a);
    }
}
if (!inputs.length) {
    console.error('usage: check-svg.mjs [--size WxH] [--max-bytes N] [--max-elements N] <file-or-dir> [...]');
    process.exit(2);
}

const files = [];
for (const input of inputs) {
    if (!fs.existsSync(input)) {
        console.error(`not found: ${input}`);
        process.exit(2);
    }
    if (fs.statSync(input).isDirectory()) {
        for (const name of fs.readdirSync(input).sort()) {
            if (name.toLowerCase().endsWith('.svg')) {
                files.push(path.join(input, name));
            }
        }
    } else {
        files.push(input);
    }
}

function parseAttrs (text, errors, where) {
    const attrs = {};
    const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let rest = text;
    let m;
    while ((m = re.exec(text))) {
        const name = m[1];
        if (name in attrs) {
            errors.push(`${where}: duplicate attribute ${name}`);
        }
        attrs[name] = m[3] === undefined ? m[4] : m[3];
    }
    rest = text.replace(re, '').replace(/\/\s*$/, '').trim();
    if (rest) {
        errors.push(`${where}: could not parse attribute text "${rest.slice(0, 40)}"`);
    }
    return attrs;
}

// Returns a list of [x, y] coordinate pairs found in the path, or pushes errors.
function checkPath (dText, errors, where) {
    const pts = [];
    const tokens = dText.match(/[A-Za-z]|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
    const leftover = dText.replace(/[A-Za-z]|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g, '').replace(/[\s,]/g, '');
    if (leftover) {
        errors.push(`${where}: unexpected characters in path data "${leftover.slice(0, 20)}"`);
    }
    if (tokens.length && tokens[0] !== 'M') {
        errors.push(`${where}: path data must start with M`);
    }
    let i = 0;
    while (i < tokens.length) {
        const cmd = tokens[i];
        if (!(cmd in ARGS)) {
            errors.push(`${where}: path command "${cmd}" not allowed (only absolute M L C Z)`);
            return pts;
        }
        i++;
        const nums = [];
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
            nums.push(Number(tokens[i]));
            i++;
        }
        const n = ARGS[cmd];
        if ((n === 0 && nums.length) || (n > 0 && (nums.length === 0 || nums.length % n !== 0))) {
            errors.push(`${where}: ${cmd} has ${nums.length} numbers`);
            continue;
        }
        for (let k = 0; k + 1 < nums.length; k += 2) {
            pts.push([nums[k], nums[k + 1]]);
        }
    }
    return pts;
}

let failed = 0;
for (const file of files) {
    const errors = [];
    const warnings = [];
    const text = fs.readFileSync(file, 'utf8');
    const base = path.basename(file);
    const bytes = Buffer.byteLength(text);
    if (bytes > opts.maxBytes) {
        errors.push(`file is ${bytes} bytes (limit ${opts.maxBytes})`);
    }
    const body = text.replace(/^﻿?\s*<\?xml[^>]*\?>/, '');
    if (/<!--|<!\[CDATA\[|<!DOCTYPE/i.test(body)) {
        errors.push('comments, CDATA and DOCTYPE are not allowed');
    }
    // Text between tags must be whitespace only.
    const between = body.replace(/<[^>]*>/g, '');
    if (between.trim()) {
        errors.push(`text content outside tags: "${between.trim().slice(0, 30)}"`);
    }
    const tags = [];
    const tagRe = /<\s*(\/?)\s*([A-Za-z_][-A-Za-z0-9_:.]*)([^>]*)>/g;
    let m;
    while ((m = tagRe.exec(body))) {
        tags.push({close: m[1] === '/', name: m[2], rest: m[3], selfClose: /\/\s*$/.test(m[3])});
    }
    const stack = [];
    let shapesSeen = 0;
    let gCount = 0;
    let svgCount = 0;
    tags.forEach((t, idx) => {
        const where = `<${t.name}> #${idx}`;
        if (t.close) {
            const open = stack.pop();
            if (open !== t.name) {
                errors.push(`${where}: closing </${t.name}> does not match <${open}>`);
            }
            return;
        }
        const attrs = parseAttrs(t.rest, errors, where);
        const parent = stack[stack.length - 1];
        if (t.name === 'svg') {
            svgCount++;
            if (idx !== 0 || svgCount > 1) {
                errors.push(`${where}: <svg> must be the single root element`);
            }
            if (opts.size) {
                const [w, h] = opts.size;
                if (attrs.width !== `${w}px` || attrs.height !== `${h}px`) {
                    errors.push(`root width/height are "${attrs.width}"/"${attrs.height}", expected "${w}px"/"${h}px"`);
                }
                if ((attrs.viewBox || '').trim().split(/[\s,]+/).map(Number).join(' ') !== `0 0 ${w} ${h}`) {
                    errors.push(`root viewBox is "${attrs.viewBox}", expected "0 0 ${w} ${h}"`);
                }
            }
        } else if (t.name === 'g') {
            gCount++;
            if (gCount > 1 || parent !== 'svg') {
                errors.push(`${where}: only one <g>, directly inside <svg>, is allowed`);
            }
            if (attrs.id !== base) {
                warnings.push(`<g> id is "${attrs.id}", expected "${base}"`);
            }
        } else if (SHAPES.has(t.name)) {
            shapesSeen++;
            if (parent !== 'g') {
                errors.push(`${where}: shapes must sit inside the single <g>`);
            }
            for (const g of GEOMETRY[t.name]) {
                if (!(g in attrs)) {
                    errors.push(`${where}: missing ${g}`);
                }
            }
            for (const k of ['fill', 'stroke']) {
                if (!(k in attrs)) {
                    errors.push(`${where}: missing ${k}`);
                } else if (!COLOUR.test(attrs[k])) {
                    errors.push(`${where}: ${k}="${attrs[k]}" must be #rrggbb or none`);
                }
            }
            if (attrs.stroke && attrs.stroke !== 'none' && !('stroke-width' in attrs)) {
                errors.push(`${where}: stroked shape without stroke-width`);
            }
            for (const k of ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'stroke-width']) {
                if (k in attrs && !NUM.test(attrs[k].trim())) {
                    errors.push(`${where}: ${k}="${attrs[k]}" is not a plain number`);
                }
            }
            let pts = [];
            if (t.name === 'path' && 'd' in attrs) {
                pts = checkPath(attrs.d, errors, where);
            } else if (t.name === 'polygon' && 'points' in attrs) {
                const nums = attrs.points.trim().split(/[\s,]+/);
                if (nums.length < 6 || nums.length % 2 || nums.some((n) => !NUM.test(n))) {
                    errors.push(`${where}: bad points list`);
                } else {
                    for (let k = 0; k < nums.length; k += 2) {
                        pts.push([Number(nums[k]), Number(nums[k + 1])]);
                    }
                }
            } else if ('cx' in attrs) {
                pts = [[Number(attrs.cx), Number(attrs.cy)]];
            } else if ('x' in attrs) {
                pts = [[Number(attrs.x), Number(attrs.y)], [Number(attrs.x) + Number(attrs.width), Number(attrs.y) + Number(attrs.height)]];
            }
            if (opts.size) {
                const [w, h] = opts.size;
                const out = pts.find(([x, y]) => x < -40 || y < -40 || x > w + 40 || y > h + 40);
                if (out) {
                    warnings.push(`${where}: point ${out[0]},${out[1]} is far outside the canvas`);
                }
            }
        } else {
            errors.push(`${where}: element <${t.name}> is not allowed`);
        }
        for (const k of Object.keys(attrs)) {
            if (FORBIDDEN_ATTRS.has(k)) {
                errors.push(`${where}: attribute ${k} is not allowed`);
            }
        }
        if (!t.selfClose) {
            stack.push(t.name);
        }
    });
    if (stack.length) {
        errors.push(`unclosed elements: ${stack.join(', ')}`);
    }
    if (svgCount !== 1) {
        errors.push('expected exactly one <svg>');
    }
    if (gCount !== 1) {
        errors.push('expected exactly one wrapping <g>');
    }
    if (shapesSeen > opts.maxElements) {
        errors.push(`${shapesSeen} shapes (limit ${opts.maxElements})`);
    }
    const status = errors.length ? 'FAIL' : 'ok  ';
    console.log(`${status} ${file}  (${shapesSeen} shapes, ${(bytes / 1024).toFixed(1)} KB)`);
    for (const e of errors.slice(0, 20)) {
        console.log(`       error: ${e}`);
    }
    if (errors.length > 20) {
        console.log(`       ... and ${errors.length - 20} more errors`);
    }
    for (const w of warnings.slice(0, 10)) {
        console.log(`       warning: ${w}`);
    }
    if (errors.length) {
        failed++;
    }
}
console.log(`${files.length - failed}/${files.length} files passed`);
process.exit(failed ? 1 : 0);
