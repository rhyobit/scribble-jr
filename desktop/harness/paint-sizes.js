// Paste-able check (run in the harness page): opens a blank character in the paint
// editor and reports whether the palettes are inside the window.
(async () => {
    const fire = (el, types) => {
        const r = el.getBoundingClientRect();
        for (const t of types) {
            el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2}));
        }
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    fire(document.querySelector('.addsprite'), ['mousedown', 'mouseup', 'click']);
    await wait(2500);
    fire(document.querySelector('#scrollarea .assetbox'), ['mousedown', 'mouseup', 'click']);
    await wait(500);
    fire(document.getElementById('library_paintme'), ['mousedown', 'mouseup', 'click']);
    await wait(2500);
    const box = (sel) => {
        const e = document.querySelector(sel);
        if (!e) {
            return sel + ': missing';
        }
        const r = e.getBoundingClientRect();
        const inside = r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0 && r.height > 0;
        return `${sel}: ${[r.x | 0, r.y | 0, r.width | 0, r.height | 0].join(',')} ${inside ? 'visible' : 'OFF-SCREEN/EMPTY'}`;
    };
    return {
        window: innerWidth + 'x' + innerHeight,
        tools: document.querySelectorAll('#paintframe .tool').length,
        checks: ['#paintframe .tool.path', '#paintframe .tool.rect', '#selectortools', '#filltools', '#paintframe .swatchbucket'].map(box)
    };
})();
