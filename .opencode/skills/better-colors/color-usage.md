# Color usage

Deploying color once the system exists: meaning, emphasis, gradients and appearance variants. For picking values see [palette-generation.md](palette-generation.md), for naming them [token-naming.md](token-naming.md), for checking pairs [contrast.md](contrast.md).

## One color, one meaning

Users read a near-miss in hue as a slightly different shade, not as a different color.

```css
/* Bad: the accent means both "link" and "decorative heading" */
a { color: #3b82f6; }
.section-title { color: #4f8ef7; }

/* Good: interactive elements own the accent; headings stay neutral */
a { color: var(--color-accent-text); }
.section-title { color: var(--color-text-primary); }
```

The rule runs both ways. A color must not be *absent* where its meaning occurs. If the accent means interactive, an interactive element rendered neutral is just as misleading.

Color is never the only carrier of meaning. Pair it with an icon, a label, or a shape. `better-accessibility` owns that requirement.

## Use tokens in their role

Apply a semantic token only for the role it names. `--color-text-secondary` is muted foreground text. Use it as a background and every future theme change that assumes the role breaks, because a value that happened to work as both stops working as both.

```css
/* Bad: separator token repurposed as a text color because it looked right */
.caption { color: var(--color-border); }

/* Bad: text token repurposed as a background */
.tag { background: var(--color-text-secondary); }
```

The role inventory in [token-naming.md](token-naming.md) is the list of roles a system needs.

## One colored action per view

Preserve an established component hierarchy that communicates emphasis another way. Do not recolor controls merely to impose this recipe.

```html
<!-- Good: one filled primary action, neutral secondaries -->
<button class="bg-accent-solid text-white">Save</button>
<button class="text-neutral-700">Cancel</button>

<!-- Bad: every action colored, so nothing is primary -->
<button class="bg-accent-solid text-white">Save</button>
<button class="bg-accent-solid text-white">Duplicate</button>
<button class="bg-accent-solid text-white">Export</button>
```

Selected states may use the accent on the glyph and label. An active tab or a checked segment is state, not emphasis.

## Gradients

**The interpolation space is a look, not a correctness setting.** Three are worth knowing, and the difference between them is most visible in the middle of the gradient:

```css
/* sRGB: the default and the classic. Midpoint darkens and mutes. */
background: linear-gradient(#3b82f6, #ec4899);

/* oklab: even brightness across the transition. The best default. */
background: linear-gradient(in oklab, #3b82f6, #ec4899);

/* oklch: travels around the hue wheel, staying vivid throughout. */
background: linear-gradient(in oklch, #3b82f6, #ec4899);
```

`oklab` and sRGB are **rectangular**, interpolating in a straight line through the color space. `oklch` is **polar**, interpolating the hue angle, so it arcs around the wheel through every hue between the stops. That is why it stays saturated and why it can produce hues nobody asked for. A blue-to-pink gradient routes through purple, which is either the look or a surprise.

**The gray dead zone is a rectangular-space problem.** Two hues on opposite sides of the wheel sit either side of the neutral axis. A straight line between them passes near gray, and the middle goes lifeless. Either switch to a polar space, which routes around the axis, or add a third stop between the two and keep the space you have.

With a polar space you also control which way it goes around:

```css
/* The short way round, usually what you want */
background: linear-gradient(in oklch shorter hue, #3b82f6, #ec4899);

/* The long way, sweeps most of the spectrum */
background: linear-gradient(in oklch longer hue, #3b82f6, #ec4899);
```

**Banding shows up on large areas.** A gradient spanning a hero with little contrast between its stops steps visibly on 8-bit displays. Widen the contrast, shrink the area, or overlay a subtle noise texture.

**Keep text off gradients where you can.** Contrast varies continuously across one, so a single measurement does not describe it. Where text must sit on a gradient, measure the worst region rather than the average, or put a scrim behind it.

## Color across cultures

Color meaning is not universal. Where a color is load-bearing in finance, status, or alerts, verify the meaning holds in every locale you ship to.

| Color | Common Western reading | Elsewhere |
| --- | --- | --- |
| Red | Danger, loss, errors | Luck, prosperity; **gains** in Chinese financial UIs |
| Green | Success, gains, go | Losses in Chinese financial UIs |
| White | Purity, cleanliness | Mourning in parts of East Asia |
| Gold | Premium, luxury | Religious significance in some regions |

The classic case is stock tickers, which show gains in green for English locales and red for Chinese ones. Where the product ships to such markets, make gain and loss per-locale tokens rather than hardcoded values.

## Light, dark and increased contrast

Every custom color needs a light and a dark variant, derived per [palette-generation.md](palette-generation.md). Beyond that, users who enable increased contrast expect visibly stronger differentiation:

```css
:root {
  --color-accent-solid: #3b82f6;
}

@media (prefers-color-scheme: dark) {
  :root { --color-accent-solid: #60a5fa; }
}

@media (prefers-contrast: more) {
  :root { --color-accent-solid: #1d4ed8; }
}
```

The increased-contrast variant widens the foreground/background gap by at least 15 points of perceived lightness over the default. Re-verify against APCA's preferred thresholds, Lc 90 body and Lc 75 non-body. Widening the gap without remeasuring is not fixing it.
