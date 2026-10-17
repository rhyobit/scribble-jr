// Reproduces "new character -> paint editor" in the built app and reports errors.
// Launch the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333,
// then: node desktop/harness/cdp-paint-new.mjs <screenshot.png>
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
    try {
        target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page');
    } catch (e) { /* not up yet */ }
    await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pending = {};
const logs = [];
ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending[msg.id]) {
        pending[msg.id](msg);
        delete pending[msg.id];
    } else if (msg.method === 'Runtime.exceptionThrown') {
        logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        logs.push(msg.params.type + ' ' + msg.params.args.map((a) => a.value || a.description).join(' '));
    } else if (msg.method === 'Log.entryAdded') {
        logs.push('log ' + msg.params.entry.level + ' ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
};
const send = (method, params = {}) => new Promise((r) => {
    const i = id++;
    pending[i] = r;
    ws.send(JSON.stringify({id: i, method, params}));
});
const evaluate = async (expr) => (await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true})).result.result?.value;
const clickEl = async (selector) => {
    const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
    if (!p) {
        return false;
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {type, x: p.x, y: p.y, button: 'left', clickCount: 1});
    }
    return true;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await sleep(2500);
await send('Page.navigate', {url: 'http://tauri.localhost/home.html'});
await sleep(3500);
console.log('new project', await clickEl('#wrapc .aproject.empty'));
await sleep(6000);
console.log('url', await evaluate('location.href'));
console.log('add character', await clickEl('.addsprite'));
await sleep(3000);
console.log('blank tile', await clickEl('#scrollarea .assetbox'));
await sleep(800);
console.log('paint button', await clickEl('#library_paintme'));
await sleep(3000);
console.log('palettes', await evaluate(`['selectortools','filltools'].map(id => { const e = document.getElementById(id); if (!e) return id + ':missing'; const r = e.getBoundingClientRect(); return id + ':' + [r.x|0, r.y|0, r.width|0, r.height|0].join(','); }).concat([
  'colour swatches: ' + document.querySelectorAll('#paintframe .swatchbucket, #paintframe [class*=swatch]').length,
  'tools: ' + document.querySelectorAll('#paintframe .tool').length,
  'window: ' + innerWidth + 'x' + innerHeight])`));
// Draw with each shape tool using real mouse input (press, drag, release).
const drag = async (x0, y0, x1, y1) => {
    await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0, y: y0});
    await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1});
    for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + Math.sin(t * 6) * 20, button: 'left', buttons: 1});
        await sleep(16);
    }
    await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1});
    await sleep(300);
};
const shapes = () => evaluate('document.getElementById("layer1") ? document.getElementById("layer1").children.length : -1');
const canvas = await evaluate(`(() => { const r = document.querySelector('#paintframe svg').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; })()`);
for (const [tool, row] of [['path', 0.3], ['ellipse', 0.5], ['rect', 0.7]]) {
    await clickEl(`.tool.${tool}`);
    const before = await shapes();
    await drag(canvas.x + canvas.w * 0.35, canvas.y + canvas.h * row, canvas.x + canvas.w * 0.6, canvas.y + canvas.h * row + 40);
    console.log(`draw with ${tool}: shapes ${before} -> ${await shapes()}`);
}
const shot = await send('Page.captureScreenshot', {format: 'png'});
if (process.argv[2] && shot.result?.data) {
    fs.writeFileSync(process.argv[2], Buffer.from(shot.result.data, 'base64'));
    console.log('screenshot', process.argv[2]);
}
console.log(logs.length ? logs.join('\n') : 'no errors logged');
ws.close();
