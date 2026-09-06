# Reading the whole system

Use this where no specific effect was named and the question is how the interface is built in general. For one named thing, use [find-the-effect.md](find-the-effect.md).

Every snippet runs in the page context, through whatever browser tooling is available: `evaluate_script` in the Chrome DevTools MCP, the console, a Playwright `page.evaluate`. Each returns data rather than printing, so the result comes back whole.

Run them in this order. Tokens first, because a page that hands you its custom properties has already told you most of the answer.

## The gotcha that costs you the run

`sheet.cssRules` throws on a cross-origin stylesheet. Every snippet that walks stylesheets wraps the access and reports what it could not read. An explanation that silently skipped the main stylesheet describes a page nobody is looking at.

## The stack first

"How was this site built" wants the frontend named before a type scale. Run this, then report each hit with its evidence, never as a bare claim:

```js
const html = document.documentElement;
const res = performance.getEntriesByType('resource').map(r => r.name);
const any = re => res.some(n => re.test(n));
const attr = sel => !!document.querySelector(sel);
({
  framework: {
    next: !!window.__NEXT_DATA__ || any(/\/_next\/static/),
    nextAppRouter: typeof self.__next_f !== 'undefined',
    nuxt: !!window.__NUXT__ || any(/\/_nuxt\//),
    remix: !!window.__remixContext,
    gatsby: !!window.___gatsby,
    astro: attr('astro-island, [data-astro-cid]'),
    svelte: attr('[class*="svelte-"]') || any(/\/_app\/immutable\//),
    angular: attr('[ng-version]'),
    reactFiber: Object.keys(document.body.firstElementChild ?? {}).some(k => k.startsWith('__react')),
  },
  styling: {
    tailwind: getComputedStyle(html).getPropertyValue('--tw-ring-offset-width') !== ''
              || !!document.querySelector('[class*="bg-linear-to"], [class*="bg-gradient-to"]'),
    tailwindV4: !!document.querySelector('[class*="bg-linear-to"]'),
    cssModules: attr('[class*="_"][class*="__"]'),
    styledComponents: attr('[class^="sc-"]') || attr('style[data-styled]'),
    emotion: attr('[class^="css-"]'),
  },
  components: {
    radix: attr('[data-radix-popper-content-wrapper], [data-radix-scroll-area-viewport]')
           || !!document.querySelector('[data-slot], [data-state][data-side]'),
    baseUi: attr('[data-base-ui-portal], [class*="base-ui"]'),
    headlessUi: attr('[data-headlessui-state]'),
    mui: attr('[class*="Mui"]'),
    arkOrChakra: attr('[data-scope][data-part]'),
  },
  motion: { animationsRunning: document.getAnimations().length, gsap: !!window.gsap },
  images: { nextImage: any(/\/_next\/image\?/), modernFormats: [...document.images].some(i => /\.(avif|webp)/.test(i.currentSrc)), srcset: [...document.images].filter(i => i.srcset).length },
  fonts: { count: document.fonts.size, variable: [...document.fonts].some(f => String(f.weight).includes(' ')), selfHosted: !any(/fonts\.g(oogleapis|static)\.com/) },
});
```

Two rules. A fingerprint is not a fact, so give the evidence: `/_next/static` in an asset path is strong, a utility-looking class name alone is weak. And a `false` is not an absence, only a fingerprint that did not fire.

## Tokens

```js
const tokens = {}; const unreadable = [];
for (const sheet of document.styleSheets) {
  let rules; try { rules = sheet.cssRules } catch { unreadable.push(sheet.href); continue }
  for (const r of rules ?? []) {
    if (r.selectorText === ':root' || r.selectorText === 'html') {
      for (const prop of r.style) {
        if (prop.startsWith('--')) tokens[prop] = r.style.getPropertyValue(prop).trim();
      }
    }
  }
}
({ tokens, unreadable, count: Object.keys(tokens).length });
```

Group the result by prefix. The prefixes are the system's own layer names, and a two-tier structure, `--blue-500` feeding `--color-text-primary`, is the seam `better-colors` calls the semantic tier.

## The type scale

Leaf text nodes only, so a wrapper's inherited size is not counted as its own step.

```js
const seen = new Map();
for (const el of document.querySelectorAll('*')) {
  if (el.children.length || !el.textContent?.trim()) continue;
  const s = getComputedStyle(el);
  const key = `${parseFloat(s.fontSize)}px  w${s.fontWeight}  lh ${s.lineHeight}  ls ${s.letterSpacing}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
[...seen].sort((a, b) => b[1] - a[1]);
```

Sorted by usage, so the body size is first and the one-offs last. Derive the ratio between adjacent sizes. A consistent ratio means a scale; scattered values mean hard-coded sizes.

## The spacing rhythm

```js
const vals = new Map();
for (const el of document.querySelectorAll('*')) {
  const s = getComputedStyle(el);
  for (const p of ['paddingTop', 'paddingLeft', 'marginTop', 'marginLeft', 'gap', 'rowGap']) {
    const v = parseFloat(s[p]);
    if (v > 0) vals.set(v, (vals.get(v) ?? 0) + 1);
  }
}
[...vals].sort((a, b) => a[0] - b[0]);
```

Look for the base unit that divides most values, then check `better-layout`'s grouping rule. Is the gap between groups at least 2× the gap within one?

## Radii, shadows, borders

```js
const grab = (prop, skip) => {
  const m = new Map();
  for (const el of document.querySelectorAll('*')) {
    const v = getComputedStyle(el)[prop];
    if (v && v !== skip) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};
({ radius: grab('borderRadius', '0px'), shadow: grab('boxShadow', 'none') });
```

Count the distinct shadows. One or two recipes is a system; nine is a page where everyone invented their own elevation.

## Motion

```js
const t = new Map();
for (const el of document.querySelectorAll('*')) {
  const s = getComputedStyle(el);
  if (s.transitionDuration === '0s') continue;
  const key = `${s.transitionProperty}  ${s.transitionDuration}  ${s.transitionTimingFunction}`;
  t.set(key, (t.get(key) ?? 0) + 1);
}
[...t].sort((a, b) => b[1] - a[1]);
```

`transition: all` shows up here as `all`. Custom curves arrive as `cubic-bezier(...)`, and the built-in keywords tell you nobody tuned them.

## Breakpoints

```js
const bp = new Set(); const unreadable = [];
for (const sheet of document.styleSheets) {
  let rules; try { rules = sheet.cssRules } catch { unreadable.push(sheet.href); continue }
  const walk = list => { for (const r of list ?? []) {
    if (r.media) { for (const m of r.media) { const hit = m.match(/(min|max)-width:\s*([\d.]+)(px|r?em)/); if (hit) bp.add(hit[0]) } }
    if (r.cssRules) walk(r.cssRules);
  }};
  walk(rules);
}
({ breakpoints: [...bp].sort(), unreadable });
```

Compare against the framework defaults. Breakpoints at exactly `640/768/1024/1280` are Tailwind's out of the box, which tells you they were never chosen.

## Fonts and theming

```js
({
  loaded: [...document.fonts].map(f => `${f.family} ${f.weight} ${f.style} ${f.status}`),
  bodyStack: getComputedStyle(document.body).fontFamily,
  variable: [...document.fonts].some(f => String(f.weight).includes(' ')),
  themeClass: document.documentElement.className || '(none)',
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
});
```

`variable: true` means one file covers a weight range. A class on `<html>` beside a `prefers-color-scheme` query means a toggle that can override the system, the mechanism `better-colors` describes.

## Reading a second state

Everything above reads one state at one width. Before writing the explanation, at minimum:

- Resize to 375px and re-run the spacing and breakpoint snippets. The values that change are what is fluid.
- Toggle the theme and re-run the token snippet. The tokens that change are the themed layer, the ones that do not are the primitives.
- Tab to the first interactive control and read its `:focus-visible` styles, since a focus ring is one of the most common absences.
