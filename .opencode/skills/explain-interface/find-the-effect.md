# Finding the layers behind an effect

Search by property signature, not by guessing the element. You rarely know the markup, but you always know which CSS properties could produce what you are looking at.

Run these through whatever browser tooling is available: `evaluate_script` in the Chrome DevTools MCP, the console, a Playwright `page.evaluate`.

## Three things that cost you the answer

**Pseudo-elements carry the effect more often than elements do.** A gradient, a noise overlay, a hairline border, a glow all commonly live on `::before` or `::after`. `getComputedStyle(el)` alone never sees them, so pass the pseudo as the second argument and check all three.

**Idle values are not effects.** `filter: blur(0px)`, `opacity: 1` and `transform: none` are what an animation library leaves on every element it touches. On one real page they turned a search into 97 hits, of which 10 mattered. Filter them out first.

**A generated stop list is one technique, not twelve stops.** Stops at `0%, 9.99%, 19.07%, ...` came from a utility following an easing curve. The extra stops keep the gradient from banding. Name the technique, never paste the stops.

## The layer search

```js
const dead = v => !v || v === 'none' || v === 'normal' || v === '1' || v === 'blur(0px)';
const PROPS = ['backgroundImage','filter','backdropFilter','mixBlendMode','maskImage','boxShadow','opacity'];
const hits = [];
for (const el of document.querySelectorAll('*')) {
  for (const pseudo of [null, '::before', '::after']) {
    const s = getComputedStyle(el, pseudo);
    const found = {};
    for (const p of PROPS) {
      const v = p === 'maskImage' ? (s.maskImage || s.webkitMaskImage) : s[p];
      if (!dead(v)) found[p] = String(v).slice(0, 200);
    }
    if (!Object.keys(found).length) continue;
    if (Object.keys(found).length === 1 && found.opacity) continue;   // opacity alone is not an effect
    const r = el.getBoundingClientRect();
    hits.push({
      tag: el.tagName.toLowerCase(), pseudo: pseudo ?? 'element',
      cls: (el.className?.toString?.() ?? '').slice(0, 90),
      z: getComputedStyle(el).zIndex,
      box: `${Math.round(r.width)}x${Math.round(r.height)} @ y${Math.round(r.top)}`,
      found,
    });
  }
}
({ total: hits.length, hits });
```

Read the result for the stack, not for one row:

- **Compare `box` against the viewport.** An element wider than `window.innerWidth`, or with a negative offset, is oversized on purpose so its edges never show.
- **Order by `y` and `z`.** That is paint order. The gradient is usually the lowest layer and the frosted panel the one above it.
- **`backdropFilter` on any row.** That layer frosts something beneath it, so the layer beneath is part of the answer.
- **`mixBlendMode` on any row.** The layer's color depends on what it covers, so you cannot explain it without naming what is underneath.

## When CSS is not the answer

Where the layer search comes back empty for the region you care about, the effect is not CSS:

```js
[...document.querySelectorAll('canvas, svg, video, img')].map(el => {
  const r = el.getBoundingClientRect();
  return { tag: el.tagName.toLowerCase(), box: `${Math.round(r.width)}x${Math.round(r.height)} @ y${Math.round(r.top)}`,
           ctx: el.tagName === 'CANVAS' ? (el.getContext('webgl2') ? 'webgl2' : el.getContext('webgl') ? 'webgl' : '2d-or-taken') : null,
           src: (el.currentSrc || el.getAttribute('src') || '').slice(0, 90) };
});
```

A `canvas` reporting `webgl` means a shader, and the honest answer is a shader plus roughly what it looks like. Say that rather than describing CSS that is not there. An `svg` may carry `<filter>` primitives worth reading directly.

## Narrowing to a region

Where the page is large, sample what actually paints at a point instead of walking everything:

```js
(x, y) => document.elementsFromPoint(x, y).slice(0, 8).map(el => {
  const s = getComputedStyle(el);
  return { tag: el.tagName.toLowerCase(), cls: (el.className?.toString?.() ?? '').slice(0, 70),
           bg: s.backgroundImage.slice(0, 80), filter: s.filter, backdrop: s.backdropFilter, blend: s.mixBlendMode };
});
```

`elementsFromPoint` returns front to back, which is the paint stack at that pixel, reversed. It is the fastest way to answer "what is actually behind this".

## Is it animated?

```js
[...document.getAnimations()].slice(0, 20).map(a => ({
  target: a.effect?.target?.tagName?.toLowerCase(),
  cls: (a.effect?.target?.className?.toString?.() ?? '').slice(0, 60),
  name: a.animationName ?? a.transitionProperty ?? '(js)',
  duration: a.effect?.getTiming?.().duration,
  easing: a.effect?.getTiming?.().easing,
}));
```

`getAnimations()` catches CSS animations, transitions and Web Animations API playback in one call, which a stylesheet walk misses.

It returns nothing on a page at rest, because a one-shot reveal has either finished or never started. A headless browser producing no frames never starts it at all, so reload, then take a screenshot every 100ms while you poll.
