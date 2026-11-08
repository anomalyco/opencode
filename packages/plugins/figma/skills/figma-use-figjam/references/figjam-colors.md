# FigJam Colors

> Part of the [figma-use-figjam skill](../SKILL.md). Canonical color palettes for FigJam node types — stickies, sections, connectors, shapes-with-text, and labels.

This is the shared color reference for every FigJam node type. Each node type has its own palette (FigJam doesn't share one universal palette across all node types), so use the table for the node type you're working with. The hex/255 conversion helper at the top is shared across all of them.

The hex values below mirror FigJam's built-in UI3 palette. The renderer's behavior is what defines whether a color is recognized as a "palette color" in the FigJam UI, so this doc is downstream of the product. If a value drifts from what FigJam renders, the doc is wrong, not the product.

The per-node-type reference files (`create-sticky.md`, `create-section.md`, `create-connector.md`, `create-shape-with-text.md`, `create-label.md`) intentionally keep their own inline palette tables so each file is self-sufficient for single-file loads. This file is the canonical place those tables converge — when a color value changes, update this file and the relevant per-node-type files together.

## Contents

- [Universal rules](#universal-rules) — `hex/255` notation, the `h()` helper, why this matters
- [Sticky palette](#sticky-palette) — `figma.createSticky()` fills
- [Section background palette](#section-background-palette) — `figma.createSection()` fills
- [Connector stroke palette](#connector-stroke-palette) — `figma.createConnector()` strokes
- [Shape coordinated palette](#shape-coordinated-palette) — `figma.createShapeWithText()` fill + stroke + text together
- [Label coordinated palette](#label-coordinated-palette) — small numbered/lettered ellipse markers
- [Plan-board accent colors](#plan-board-accent-colors) — semantic accents for badges, status dots, and emphasis markers (not section fills)
- [Default text color](#default-text-color) — Charcoal `#1E1E1E`

## Universal rules

### Use `hex/255` notation, not pre-computed decimals

FigJam recognizes a color as a "palette color" only when its RGB channels match a palette entry exactly. Pre-rounded decimals like `{ r: 0.65, g: 0.85, b: 1 }` drift just enough that FigJam treats the color as **custom** instead of **palette**, which (a) breaks color-by-name lookups, (b) prevents users from clicking the palette swatch to change it, and (c) makes diagrams look subtly "off".

**Always** write color values as `hex/255`:

```js
// CORRECT — exact palette match
sticky.fills = [{ type: 'SOLID', color: { r: 0xa8/255, g: 0xda/255, b: 0xff/255 } }]  // Blue #A8DAFF

// WRONG — pre-rounded, FigJam will mark this "custom"
sticky.fills = [{ type: 'SOLID', color: { r: 0.66, g: 0.85, b: 1.0 } }]
```

### The `h()` helper

Almost every script that touches FigJam colors uses this one-liner. Copy-paste it into the top of your script:

```js
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

// Now write colors clean:
sticky.fills = [{ type: 'SOLID', color: h(0xa8, 0xda, 0xff) }]  // Blue #A8DAFF
```

### Don't invent custom colors

Strongly prefer the palette colors below over arbitrary hex values. If the user explicitly asks for a brand color, use it; otherwise, sticking to FigJam's built-in palette keeps boards visually coherent and lets users re-color via the FigJam UI.

---

## Sticky palette

Used for `figma.createSticky()` fills — see [create-sticky](create-sticky.md).

| Color  | Hex       |
| ------ | --------- |
| White  | `#FFFFFF` |
| Gray   | `#E6E6E6` |
| Green  | `#B3EFBD` |
| Teal   | `#B3F4EF` |
| Blue   | `#A8DAFF` |
| Violet | `#D3BDFF` |
| Pink   | `#FFA8DB` |
| Red    | `#FFB8A8` |
| Orange | `#FFD3A8` |
| Yellow | `#FFE299` |

Sticky semantics commonly used: blue=discussion, yellow=question, green=positive, pink=concern, red=blocker, teal=decision, violet=ideation.

## Section background palette

Used for `figma.createSection()` fills — see [create-section](create-section.md). Sections typically use lighter tints than stickies. When creating multiple sections, vary the colors so the user can visually distinguish them.

| Color        | Hex       |
| ------------ | --------- |
| White        | `#FFFFFF` |
| Light gray   | `#F9F9F9` |
| Light green  | `#EBFFEE` |
| Light teal   | `#F1FEFD` |
| Light blue   | `#F5FBFF` |
| Light violet | `#F8F5FF` |
| Light pink   | `#FFF0FA` |
| Light red    | `#FFF5F5` |
| Light orange | `#FFF7F0` |
| Light yellow | `#FFFBF0` |

## Connector stroke palette

Used for `figma.createConnector()` `strokes` — see [create-connector](create-connector.md). Connector text labels have their own background and color independently of the line.

| Color      | Hex       |
| ---------- | --------- |
| Black      | `#1E1E1E` |
| Dark gray  | `#757575` |
| Gray       | `#B3B3B3` |
| Light gray | `#D9D9D9` |
| Green      | `#66D575` |
| Teal       | `#5AD8CC` |
| Blue       | `#3DADFF` |
| Violet     | `#874FFF` |
| Pink       | `#F849C1` |
| Red        | `#FF7556` |
| Orange     | `#FF9E42` |
| Yellow     | `#FFC943` |
| White      | `#FFFFFF` |

## Shape coordinated palette

Used for `figma.createShapeWithText()` — see [create-shape-with-text](create-shape-with-text.md) and [create-label](create-label.md). FigJam shapes coordinate three colors together: **fill**, **stroke**, and **text**. Setting only one will produce an off-palette shape (e.g., dark text on a dark fill, or unmatched stroke).

```js
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const DARK = h(0x1e, 0x1e, 0x1e)

const SHAPE_PRESETS = {
  // White-text presets (saturated fills)
  black:    { fill: h(0x1e, 0x1e, 0x1e), stroke: h(0xb3, 0xb3, 0xb3), text: WHITE },
  darkGray: { fill: h(0x75, 0x75, 0x75), stroke: h(0x5e, 0x5e, 0x5e), text: WHITE },
  green:    { fill: h(0x66, 0xd5, 0x75), stroke: h(0x3e, 0x9b, 0x4b), text: WHITE },
  teal:     { fill: h(0x5a, 0xd8, 0xcc), stroke: h(0x36, 0x9e, 0x94), text: WHITE },
  blue:     { fill: h(0x3d, 0xad, 0xff), stroke: h(0x00, 0x7a, 0xd2), text: WHITE },
  violet:   { fill: h(0x87, 0x4f, 0xff), stroke: h(0x54, 0x27, 0xb4), text: WHITE },
  pink:     { fill: h(0xf8, 0x49, 0xc1), stroke: h(0xb4, 0x24, 0x87), text: WHITE },
  red:      { fill: h(0xff, 0x75, 0x56), stroke: h(0xdc, 0x30, 0x09), text: WHITE },
  orange:   { fill: h(0xff, 0x9e, 0x42), stroke: h(0xeb, 0x75, 0x00), text: WHITE },

  // Dark-text presets (lighter fills)
  gray:      { fill: h(0xb3, 0xb3, 0xb3), stroke: h(0x8f, 0x8f, 0x8f), text: DARK },
  lightGray: { fill: h(0xd9, 0xd9, 0xd9), stroke: h(0xb3, 0xb3, 0xb3), text: DARK },
  yellow:    { fill: h(0xff, 0xc9, 0x43), stroke: h(0xe8, 0xa3, 0x02), text: DARK },
  white:     { fill: h(0xff, 0xff, 0xff), stroke: h(0xb3, 0xb3, 0xb3), text: DARK },
}

function applyShapeColor(shape, preset) {
  shape.fills = [{ type: 'SOLID', color: preset.fill }]
  shape.strokes = [{ type: 'SOLID', color: preset.stroke }]
  shape.text.fills = [{ type: 'SOLID', color: preset.text }]
}
```

## Label coordinated palette

Labels (small numbered/lettered circle callouts created with `figma.createShapeWithText({shapeType:'ELLIPSE'})`) use the same coordinated fill/stroke/text system as shapes — see [create-label](create-label.md). The `SHAPE_PRESETS` map above works for labels too.

If you want to inline only the most-common label preset (blue numbered circles for annotation legends):

```js
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const PRESET_BLUE = { fill: h(0x3d, 0xad, 0xff), stroke: h(0x00, 0x7a, 0xd2), text: WHITE }
```

## Plan-board accent colors

Board-content layouts (templates, retros, brainstorms — see [plan-board-content](plan-board-content.md)) use a small set of saturated accent colors for badges, status dots, and emphasis markers. These are designer-chosen, **not** FigJam palette swatches — applying them won't show as palette colors in the FigJam UI, and that's intentional (they're for in-content accents, not for fills the user will recolor).

For section backgrounds, use the [Section background palette](#section-background-palette) above. For badge/dot accents:

```js
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const black     = h(0x12, 0x12, 0x12)
const gray      = h(0x59, 0x59, 0x59)
const red       = h(0xbf, 0x2e, 0x2e)
const orange    = h(0xb8, 0x61, 0x14)
const green     = h(0x1f, 0x80, 0x4d)
const blue      = h(0x38, 0x66, 0xbf)
const purple    = h(0x73, 0x4d, 0xa6)
const attention = h(0xd9, 0xa6, 0x1a) // gold
```

Use these for badges, status indicators, and other small accent marks — not for section backgrounds, sticky fills, or shape fills (those have their own coordinated palettes above).

## Default text color

For text nodes, sticky text, shape text, and any FigJam content where the user hasn't specified a text color, default to **Charcoal `#1E1E1E`** — see [edit-text](edit-text.md).

```js
textNode.fills = [{ type: 'SOLID', color: { r: 0x1e/255, g: 0x1e/255, b: 0x1e/255 } }]
```

Avoid mid-grays (`#757575`, `#B3B3B3`, `#D9D9D9`) for body text — they read as unfinished or low-contrast on FigJam's near-white canvas.
