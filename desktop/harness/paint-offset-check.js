// Run in the harness editor page: opens a blank character, draws a rectangle between
// two known screen points and reports where it actually landed.
(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, types) => {
        const r = el.getBoundingClientRect();
        for (const t of types) {
            el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2}));
        }
    };
    const ev = (el, t, x, y) => el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, clientX: x, clientY: y, view: window}));
    fire(document.querySelector('.addsprite'), ['mousedown', 'mouseup', 'click']);
    await wait(2500);
    fire(document.querySelector('#scrollarea .assetbox'), ['mousedown', 'mouseup', 'click']);
    await wait(500);
    fire(document.getElementById('library_paintme'), ['mousedown', 'mouseup', 'click']);
    await wait(2500);
    fire(document.querySelector('#paintframe .tool.rect'), ['mousedown', 'mouseup']);
    const svg = document.querySelector('#paintframe svg');
    const r = svg.getBoundingClientRect();
    const from = {x: Math.round(r.x + r.width * 0.6), y: Math.round(r.y + r.height * 0.6)};
    const to = {x: from.x + 120, y: from.y + 90};
    ev(svg, 'mousedown', from.x, from.y);
    for (let i = 1; i <= 10; i++) {
        ev(window, 'mousemove', from.x + 12 * i, from.y + 9 * i);
    }
    ev(window, 'mouseup', to.x, to.y);
    await wait(300);
    const shapes = document.getElementById('layer1').children;
    const b = shapes[shapes.length - 1].getBoundingClientRect();
    return {
        zoom: svg.getScreenCTM().a,
        draggedFrom: from,
        drawnAt: {x: Math.round(b.x), y: Math.round(b.y)},
        offset: {x: Math.round(b.x - from.x), y: Math.round(b.y - from.y)}
    };
})();
