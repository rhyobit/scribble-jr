// Smoke test for the built app: launch scratchjr-desktop.exe with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333, then run
// node desktop/harness/cdp-smoke.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect () {
    for (let i = 0; i < 30; i++) {
        try {
            const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
            const page = targets.find((t) => t.type === 'page' && t.url.includes('tauri.localhost'));
            if (page) {
                return page.webSocketDebuggerUrl;
            }
        } catch (e) { /* not up yet */ }
        await sleep(500);
    }
    throw new Error('webview not reachable');
}

const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = {};
ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending[msg.id]) {
        pending[msg.id](msg);
        delete pending[msg.id];
    }
};
const send = (method, params = {}) => new Promise((r) => {
    const id = nextId++;
    pending[id] = r;
    ws.send(JSON.stringify({id, method, params}));
});
const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
    if (r.result.exceptionDetails) {
        return 'EXCEPTION: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    }
    return r.result.result.value;
};
const go = async (url, wait = 4000) => {
    await send('Page.navigate', {url});
    await sleep(wait);
};
const check = (label, value) => console.log(label.padEnd(28), JSON.stringify(value));

await send('Runtime.enable');
await sleep(3000);
check('index: page', await evaluate('location.href + " bridge=" + !!window.__sjrDesktopBridge'));
check('index: settings', await evaluate(`new Promise(r => iOS.getsettings(r))`));

await go('http://tauri.localhost/home.html');
check('home: open button', await evaluate('!!document.getElementById("desktopOpenProject")'));
check('home: ui sounds', await evaluate('Object.keys(ScratchAudio.uiSounds).length'));

// Create a project with a real mouse click on the lobby's "+" tile.
const plus = await evaluate(`(() => { const el = document.querySelector('#wrapc .aproject.empty'); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {type, x: plus.x, y: plus.y, button: 'left', clickCount: 1});
}
await sleep(6000);
check('editor: url', await evaluate('location.href'));
check('editor: sprites', await evaluate('document.querySelectorAll(".spritethumb, [id^=\\"Star\\"]").length'));
check('editor: hit-test patch', await evaluate('SVGSVGElement.prototype.getIntersectionList.toString().includes("getBBox")'));
check('db: projects', await evaluate(`__TAURI_INTERNALS__.invoke('db_query', {json: JSON.stringify({stmt: 'select id, name from projects', values: []})})`));
check('db: attach blocked', await evaluate(`__TAURI_INTERNALS__.invoke('db_stmt', {json: JSON.stringify({stmt: "ATTACH DATABASE 'C:/Users/Public/x.db' AS x", values: []})})`));
check('nav: external blocked', await evaluate(`(async () => { location.href = 'https://example.com/'; await new Promise(r => setTimeout(r, 1500)); return location.host; })()`));
ws.close();
