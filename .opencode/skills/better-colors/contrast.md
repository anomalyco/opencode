# Contrast

Contrast is measured between a **foreground color**, meaning text, an icon, or a UI element, and the **background color** it actually renders against, usually the nearest ancestor that paints one. Identify that background first. Measuring against the page background when the element sits on a card gives the wrong answer.

**Report, don't repaint.** When a check fails, report the pair, its measured value and the threshold it misses, and leave the colors unchanged. They are a design decision. Apply the fix below only when asked.

`better-accessibility` decides when contrast is required and whether a given pair must pass. This file covers measuring the pair and, on request, changing it.

## APCA thresholds (recommended)

APCA (Accessible Perceptual Contrast Algorithm) models perceived contrast more accurately than WCAG 2 and is the better default for design decisions. Lc (Lightness Contrast) measures perceived contrast between foreground and background. These levels simplify APCA's full font-size and weight lookup table:

| Content type | Minimum | Preferred |
| --- | --- | --- |
| Body text (columns or blocks of text) | Lc 75 | Lc 90 |
| Non-body text (labels, headlines) | Lc 60 | Lc 75 |
| Large text (≥36px) | Lc 45 | Lc 60 |
| UI components | Lc 30 | n/a |

Lc 30 is also APCA's minimum for disabled and placeholder text. The floor for a non-text element to be discernible at all is Lc 15.

Lc is signed: positive means dark text on a light background, negative means light text on a dark background. Compare the absolute value against the threshold.

## WCAG 2 thresholds (for legal compliance)

WCAG 2 is still required for formal WCAG 2.x conformance claims. Its luminance ratio is both too strict and too lenient depending on the pair, but it has the legal standing.

| Content type | AA | AAA |
| --- | --- | --- |
| Normal text (<24px / <18.5px bold) | 4.5:1 | 7:1 |
| Large text (≥24px / ≥18.5px bold) | 3:1 | 4.5:1 |
| UI components and graphical objects | 3:1 | n/a |

WCAG defines large text in points: 18pt ≈ `24px`, 14pt bold ≈ `18.5px`.

When a project must claim WCAG conformance, WCAG is the gate and APCA is the tiebreaker for anything above it.

## Fixing a failing pair (on request)

**Change lightness first.** It is the channel contrast responds to. Hue and saturation move the measured value far less, so fixing contrast by changing hue is wasted effort.

Move the foreground away from the background in perceived lightness, holding hue and saturation, then remeasure. Keeping hue fixed is what stops a contrast fix becoming a palette change.

```css
/* Failing: text too close to its background in lightness (Lc ≈ 50) */
color: #7d93b0;
background: #eef2f7;

/* Fixed: darker text, same hue (Lc ≈ 90) */
color: #2b3a4f;
background: #eef2f7;
```

Two constraints on the fix:

- **Mid-lightness backgrounds cap what is achievable.** On a background near 75% perceived lightness, even pure black text reaches only about Lc 60. Body text needs a background near one extreme, so a mid-range background is the thing that has to change.
- **Pushing lightness can push the color out of gamut.** Reduce saturation as needed to keep it renderable. See [color-formats.md](color-formats.md).

Always remeasure after changing a value. Do not assume a fix landed.

## Quick approximations

Useful for a first pass and approximations. Verify by measuring before reporting a result.

For body text targeting |Lc| ≥ 75:

- **Light background (above ~90% perceived lightness):** foreground below ~35%.
- **Dark background (below ~25% perceived lightness):** foreground above ~90%.

The gap is asymmetric because APCA is polarity-aware. Mirrored pairs do not score identically, which is why a pair passing in light mode can fail in dark.

**Light or dark background?** The crossover is around 73% perceived lightness. Above it use dark text; at or below it light text scores higher. That is higher than intuition suggests. Between roughly 60% and 73% the background already looks light, yet white text still measures meaningfully better than black.

## What to check

- **Every pair, in every appearance.** A pair passing in light mode can fail in dark. The palettes are not mirror images.
- **Translucent surfaces.** A color on a `backdrop-filter` header or an overlay shifts with whatever scrolls behind it. Test against the lightest and darkest content it can sit over, or make the surface opaque enough that the shift cannot break the pair.
- **Computed colors.** `color-mix()`, relative color syntax and opacity modifiers resolve at render time; measure the rendered result, not the declaration.
- **Text over images.** There is no single background color. Measure the worst region, or guarantee one with a scrim.
