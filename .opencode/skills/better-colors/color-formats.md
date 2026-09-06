# Color formats

Which notation to write colors in, how to convert between them and what happens at the edges of a display's gamut. Every other rule in this skill is stated perceptually and holds whatever notation you write.

## Choosing a notation

| Notation | Good for | Weakness |
| --- | --- | --- |
| Hex | Universal support, compact, what design tools hand you | Opaque. No channel is readable or editable by hand |
| `rgb()` | Same reach as hex, readable alpha | Channels do not correspond to anything a designer thinks about |
| `hsl()` | Channels look like design controls | Its lightness is not perceptual and its hue drifts; a ramp built by varying lightness bunches at one end and shifts hue |
| `oklch()` | Perceptually uniform lightness, stable hue, predictable ramps | Baseline 2023, so very old browser matrices need a fallback |

**Match whatever the project already uses.** Notation is not a defect: a project on hex is not doing it wrong.

**For a genuinely new color system, `oklch()` is the best default.** Even lightness steps stay even, and a fixed hue stays fixed. See [palette-generation.md](palette-generation.md).

```css
oklch(L C H)          /* lightness 0–1, chroma 0–~0.4, hue 0–360 */
oklch(L C H / alpha)  /* alpha uses a slash, never a comma */
```

## Converting

Convert when the user asks, when an agreed migration is in scope, or when the project is standardizing on a notation and this value is the straggler. Never convert an isolated value in a project that deliberately uses something else and never because this skill happened to load.

When conversion is in scope, change the values and nothing else:

- Leave CSS keywords alone: `currentColor`, `inherit`, `transparent`, `initial`, `unset`.
- Leave gradient functions alone. Convert the color stops inside them; do not touch the interpolation method.
- Leave colors in third-party configs that expect a specific format.
- Preserve comments and formatting.

```css
/* Before */
color: #3b82f6;
border: 1px solid rgba(0, 0, 0, 0.1);

/* After */
color: oklch(0.623 0.188 259.815);
border: 1px solid oklch(0 0 0 / 0.1);
```

Bulk conversion is a migration, not cleanup. It shifts every rendered color by a rounding margin and touches files nobody asked about, so it has to be the task rather than a side effect.

## Gamut

Every sRGB color exists in Display P3, but not the reverse. P3 covers roughly 50% more colors, which matters only for the most saturated values. A color at 60% of maximum vividness looks the same on both.

A color more vivid than its display can render gets clipped, and clipping is not graceful. It flattens neighbouring steps into one rendered color, so the top of a ramp can lose its distinctions on an sRGB screen. Maximum vividness varies by hue and lightness. Cyans top out far lower than reds and purples, so a clipping ramp clips at some steps and not others.

The fix is to reduce vividness while holding hue and lightness. Generate ramps against sRGB unless the product is display-restricted, and add P3 as an enhancement:

```css
.accent {
  background: #3b82f6;
}

@media (color-gamut: p3) {
  .accent {
    background: oklch(0.62 0.24 259);
  }
}
```

Order matters. The sRGB value comes first so every display gets something, and the P3 rule overrides only where it will render. A P3 color with no fallback is a `HIGH` finding; it does not degrade, it fails.

For browser matrices predating `oklch()` support, the same layering works with `@supports`:

```css
.accent {
  background: #3b82f6;
}

@supports (color: oklch(0 0 0)) {
  .accent {
    background: oklch(0.62 0.19 259);
  }
}
```

Check the project's actual browser matrix before adding this. On a modern baseline it is dead weight.

## Modern CSS worth knowing

- **`color-mix()`** derives one color from another, as in `color-mix(in oklab, var(--color-accent-solid) 15%, white)` for a tinted background. Useful for states, but keep generated values out of the token layer, since a mixed color cannot be inspected in a design tool.
- **Relative color syntax** adjusts one channel of an existing color. `oklch(from var(--color-accent-solid) calc(l - 0.1) c h)` darkens the accent by hand. Powerful and easy to overuse, since a token defined by three chained derivations is unreadable.
- **`light-dark()`** puts both appearances in one declaration. See [palette-generation.md](palette-generation.md).

All three compute at render time, so their output cannot be contrast-checked statically. Measure the rendered result.
