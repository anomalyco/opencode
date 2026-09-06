# Spacing and sizing

A sensible scale and comfortable spacing do more for typography than any effect.

## Units

| Unit | Behavior |
| --- | --- |
| `px` | Fixed |
| `em` | Scales with the current font size |
| `rem` | Scales with the root font size |
| `%` on `font-size` | Relative to the parent's font size, behaves like `em` |

## Type scale

A small set of sizes used across a product, deviated from as little as possible. Hard-coding sizes with no system behind them breaks down at scale.

```css
:root {
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
}
```

Pick an existing scale or define one. Tailwind's (`text-xs` through `text-9xl`, each class pairing a size with a matching line height) is a solid ready-made choice.

Solo, the default names work fine given clear rules for where each size is used. On a team, name sizes semantically. `text-sm` tells you the size but not the use, where `text-body-sm` carries both.

A role-based scale pairs each size with its line-height and weight, making a role one decision instead of three. A starting point for a product interface:

| Role | Size | Line-height | Weight |
| --- | --- | --- | --- |
| Display | `2.25rem` (36px) | `1.1` | `600` |
| Title | `1.5rem` (24px) | `1.2` | `600` |
| Heading | `1.125rem` (18px) | `1.3` | `600` |
| Body | `1rem` (16px) | `1.5` | `400` |
| Caption | `0.8125rem` (13px) | `1.4` | `400` |

Emphasis within a role is one weight step up (`400` → `500`), not a size change.

## Heading hierarchy

Assign each heading level to a descending step of the scale, so hierarchy comes from the scale instead of one-off sizes:

```css
h1 { font-size: var(--text-2xl); }
h2 { font-size: var(--text-xl); }
h3 { font-size: var(--text-lg); }
```

In Tailwind the same mapping is utility classes per level (`text-2xl`, `text-xl`, `text-lg`), centralized in a component or `@layer base` rather than repeated inline.

When reviewing, compare the computed size of headings within each semantic section. A child rendering more prominently than its parent breaks the hierarchy. Deep levels may share a size where the scale runs out of comfortable steps, as long as weight or letter-spacing keeps them distinct. A heading is never smaller than body text unless it is deliberately a label-style overline.

Heading semantics and outline quality belong to `better-accessibility`. Pick the element from the document structure, then use this skill to make that structure visually legible. Never pick a heading element for its browser-default size.

## Kerning and letter-spacing

- **Kerning** adjusts specific pairs such as `AV` or `Ye`. It is built into the font and applied automatically. Switch it off only deliberately, with `font-kerning: none`.
- **`letter-spacing`** adds the same space between every character.

```css
/* Good */
.display-heading {
  letter-spacing: -0.02em;
}

.uppercase-label {
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

## Line-height

| Text | Value |
| --- | --- |
| Headings | ~`1.1` |
| Body copy | `1.5`–`1.6` |

Tailwind's `leading-snug`, `leading-normal` and `leading-relaxed` are sensible defaults that rarely need overriding. A tightly-leaded paragraph is harder to read than a taller row is to fit.

```css
/* Bad: card description at heading leading */
.card-description { line-height: 1.1; }

/* Good: it wraps to 3 lines, so it reads as body text */
.card-description { line-height: 1.4; }
```

## Text trimming with text-box

Fonts reserve space above and below the letters, which is why text sits slightly too low in buttons and badges. `text-box` trims it. Two parts: which edges to trim (`trim-both`, `trim-start`, `trim-end`) and where:

| Keyword | Trims at |
| --- | --- |
| `cap` | The cap height (top) |
| `alphabetic` | The baseline (bottom) |
| `text` | The font's own text edge, keeping room for descenders |

```css
/* trim top and bottom */
.badge {
  text-box: trim-both cap alphabetic;
}

/* trim only the top */
.heading {
  text-box: trim-start cap;
}

/* trim only the bottom */
.label {
  text-box: trim-end alphabetic;
}
```

Supported in Chromium (133+) and Safari (18.2+), not yet Firefox. Treat it as progressive enhancement, where unsupported browsers keep the default leading.
