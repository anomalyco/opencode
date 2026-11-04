# Create Shapes with Text

> Part of the [figma-use-figjam skill](../SKILL.md). Creating shapes with embedded text for diagrams and visual layouts.

**Scope:** ShapeWithText nodes are FigJam-specific geometric shapes with built-in text, created with `figma.createShapeWithText()`. For tables, see [create-table](create-table.md). For sections, see [create-section](create-section.md). For stickies, see [create-sticky](create-sticky.md).

**When NOT to use this skill:** For tabular-data (e.g. data tables, spreadsheets, comparison tables, rosters, or any row/column grid of text or data), use the [create-table](create-table.md) skill instead. Do not build a table-like layout from a grid of shapes.

## Creating a Shape

```javascript
const shape = figma.createShapeWithText()
// Default shapeType is 'ELLIPSE'

await figma.loadFontAsync(shape.text.fontName)
shape.text.characters = 'Step 1'

console.log('Created shape:', shape.id, shape.shapeType, shape.text.characters)
figma.closePlugin()
```

## Shape Types

Set the `shapeType` property **after** creation. It defaults to `'ELLIPSE'`.

```javascript
const shape = figma.createShapeWithText()
shape.shapeType = 'DIAMOND'
```

Available shape types:

| Category          | Shape types                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Basic             | `SQUARE`, `ELLIPSE`, `ROUNDED_RECTANGLE`, `DIAMOND`, `TRIANGLE_UP`, `TRIANGLE_DOWN`                                      |
| Arrows & Chevrons | `ARROW_LEFT`, `ARROW_RIGHT`, `CHEVRON`, `PENTAGON`, `HEXAGON`, `OCTAGON`                                                 |
| Flowchart         | `PARALLELOGRAM_RIGHT`, `PARALLELOGRAM_LEFT`, `TRAPEZOID`, `PREDEFINED_PROCESS`, `MANUAL_INPUT`, `SUMMING_JUNCTION`, `OR` |
| Engineering       | `ENG_DATABASE` (Cylinder), `ENG_QUEUE` (Horizontal cylinder), `ENG_FILE` (File), `ENG_FOLDER` (Folder)                   |
| Other             | `SHIELD`, `DOCUMENT_SINGLE`, `DOCUMENT_MULTIPLE`, `SPEECH_BUBBLE`, `STAR`, `PLUS`, `INTERNAL_STORAGE`                    |

### Creating Different Shape Types

```javascript
const types = ['SQUARE', 'DIAMOND', 'ELLIPSE', 'ROUNDED_RECTANGLE']
// All shapes share the same default font — load once before the loop instead
// of awaiting per-iteration.
const probe = figma.createShapeWithText()
await figma.loadFontAsync(probe.text.fontName)
probe.remove()
const shapes = []
for (const type of types) {
  const s = figma.createShapeWithText()
  s.shapeType = type
  s.text.characters = type
  shapes.push(s)
}
figma.closePlugin()
```

## Setting Text

ShapeWithText nodes expose a `text` sublayer (a `TextSublayerNode`). The default font is **"Inter Medium"** (not "Inter Regular"). You must load the shape's own font before changing text. **Never hardcode a font name** — always read it from `shape.text.fontName`.

**Put all text content directly into `shape.text.characters`.** Do not split text into a short label and a separate description field — all content the user expects to see in the shape must be set as the characters. The `fitShapeToText` utility will automatically size the shape to fit the full text.

```javascript
const shape = figma.createShapeWithText()
await figma.loadFontAsync(shape.text.fontName)
shape.text.characters = 'Decision?'

figma.closePlugin()
```

To modify text on an existing shape:

```javascript
const shape = await figma.getNodeByIdAsync('123:456')
if (shape && shape.type === 'SHAPE_WITH_TEXT') {
  await figma.loadFontAsync(shape.text.fontName)
  console.log('Before:', shape.text.characters)
  shape.text.characters = 'Updated label'
  console.log('After:', shape.text.characters)
}
figma.closePlugin()
```

## Color Presets

FigJam shapes have **coordinated fill, stroke, and text colors**. When applying a color, you must set all three to match the FigJam palette — otherwise the shape will look wrong (e.g., dark text on a dark fill, or missing stroke). Strongly prefer colors from this list instead of custom colors. For the canonical palette across all FigJam node types, see [figjam-colors](figjam-colors.md).

Each color preset defines:

- **Fill**: the shape's background color (`shape.fills`)
- **Stroke**: the shape's outline color (`shape.strokes`)
- **Text**: the text color (`shape.text.fills` — set after loading fonts)

### Color Preset Map

Use this map in your code to apply coordinated colors. **CRITICAL**: Use `hex/255` notation (e.g. `0x66/255`) for exact palette matching — rounded decimals cause FigJam to treat the color as "custom" instead of a palette color.

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const DARK = h(0x1e, 0x1e, 0x1e)

const SHAPE_COLOR_PRESETS = {
  // Dark fills use white text; stroke uses darker variant
  black: { fill: h(0x1e, 0x1e, 0x1e), stroke: h(0xb3, 0xb3, 0xb3), text: WHITE },
  darkGray: { fill: h(0x75, 0x75, 0x75), stroke: h(0x5e, 0x5e, 0x5e), text: WHITE },
  green: { fill: h(0x66, 0xd5, 0x75), stroke: h(0x3e, 0x9b, 0x4b), text: WHITE },
  teal: { fill: h(0x5a, 0xd8, 0xcc), stroke: h(0x36, 0x9e, 0x94), text: WHITE },
  blue: { fill: h(0x3d, 0xad, 0xff), stroke: h(0x00, 0x7a, 0xd2), text: WHITE },
  violet: { fill: h(0x87, 0x4f, 0xff), stroke: h(0x54, 0x27, 0xb4), text: WHITE },
  pink: { fill: h(0xf8, 0x49, 0xc1), stroke: h(0xb4, 0x24, 0x87), text: WHITE },
  red: { fill: h(0xff, 0x75, 0x56), stroke: h(0xdc, 0x30, 0x09), text: WHITE },
  orange: { fill: h(0xff, 0x9e, 0x42), stroke: h(0xeb, 0x75, 0x00), text: WHITE },

  // Light fills use dark text; stroke uses the corresponding dark variant
  gray: { fill: h(0xb3, 0xb3, 0xb3), stroke: h(0x8f, 0x8f, 0x8f), text: DARK },
  lightGray: { fill: h(0xd9, 0xd9, 0xd9), stroke: h(0xb3, 0xb3, 0xb3), text: DARK },
  lightGreen: { fill: h(0xcd, 0xf4, 0xd3), stroke: h(0x66, 0xd5, 0x75), text: DARK },
  lightTeal: { fill: h(0xc6, 0xfa, 0xf6), stroke: h(0x5a, 0xd8, 0xcc), text: DARK },
  lightBlue: { fill: h(0xc2, 0xe5, 0xff), stroke: h(0x3d, 0xad, 0xff), text: DARK },
  lightViolet: { fill: h(0xdc, 0xcc, 0xff), stroke: h(0x87, 0x4f, 0xff), text: DARK },
  lightPink: { fill: h(0xff, 0xc2, 0xec), stroke: h(0xf8, 0x49, 0xc1), text: DARK },
  lightRed: { fill: h(0xff, 0xcd, 0xc2), stroke: h(0xff, 0x75, 0x56), text: DARK },
  lightOrange: { fill: h(0xff, 0xe0, 0xc2), stroke: h(0xff, 0x9e, 0x42), text: DARK },
  yellow: { fill: h(0xff, 0xc9, 0x43), stroke: h(0xe8, 0xa3, 0x02), text: DARK },
  lightYellow: { fill: h(0xff, 0xec, 0xbd), stroke: h(0xff, 0xc9, 0x43), text: DARK },
  white: { fill: h(0xff, 0xff, 0xff), stroke: h(0xb3, 0xb3, 0xb3), text: DARK },
}
```

### Hex Reference

| Color        | Fill Hex  | Stroke Hex | Text  |
| ------------ | --------- | ---------- | ----- |
| Black        | `#1E1E1E` | `#B3B3B3`  | white |
| Dark gray    | `#757575` | `#5E5E5E`  | white |
| Gray         | `#B3B3B3` | `#8F8F8F`  | dark  |
| Light gray   | `#D9D9D9` | `#B3B3B3`  | dark  |
| Green        | `#66D575` | `#3E9B4B`  | white |
| Light green  | `#CDF4D3` | `#66D575`  | dark  |
| Teal         | `#5AD8CC` | `#369E94`  | white |
| Light teal   | `#C6FAF6` | `#5AD8CC`  | dark  |
| Blue         | `#3DADFF` | `#007AD2`  | white |
| Light blue   | `#C2E5FF` | `#3DADFF`  | dark  |
| Violet       | `#874FFF` | `#5427B4`  | white |
| Light violet | `#DCCCFF` | `#874FFF`  | dark  |
| Pink         | `#F849C1` | `#B42487`  | white |
| Light pink   | `#FFC2EC` | `#F849C1`  | dark  |
| Red          | `#FF7556` | `#DC3009`  | white |
| Light red    | `#FFCDC2` | `#FF7556`  | dark  |
| Orange       | `#FF9E42` | `#EB7500`  | white |
| Light orange | `#FFE0C2` | `#FF9E42`  | dark  |
| Yellow       | `#FFC943` | `#E8A302`  | dark  |
| Light yellow | `#FFECBD` | `#FFC943`  | dark  |
| White        | `#FFFFFF` | `#B3B3B3`  | dark  |

_white = `#FFFFFF`, dark = `#1E1E1E`_

### Applying a Color Preset

Always set fill, stroke, and text color together:

```javascript
function applyColorPreset(shape, preset) {
  shape.fills = [{ type: 'SOLID', color: preset.fill }]
  shape.strokes = [{ type: 'SOLID', color: preset.stroke }]
  shape.text.fills = [{ type: 'SOLID', color: preset.text }]
}

const shape = figma.createShapeWithText()
await figma.loadFontAsync(shape.text.fontName)
shape.text.characters = 'Start'
applyColorPreset(shape, SHAPE_COLOR_PRESETS.lightGreen)

figma.closePlugin()
```

### Changing Color on an Existing Shape

```javascript
const shape = await figma.getNodeByIdAsync('123:456')
if (shape && shape.type === 'SHAPE_WITH_TEXT') {
  await figma.loadFontAsync(shape.text.fontName)
  const preset = SHAPE_COLOR_PRESETS.lightBlue
  shape.fills = [{ type: 'SOLID', color: preset.fill }]
  shape.strokes = [{ type: 'SOLID', color: preset.stroke }]
  shape.text.fills = [{ type: 'SOLID', color: preset.text }]
}
figma.closePlugin()
```

## Resizing

Use `resize(width, height)` to change the size. Both values must be >= 0.01. `width` and `height` properties are **read-only**. `rescale(scale)` resizes proportionally from the top-left corner.

## Sizing Shapes to Fit Text (REQUIRED)

**CRITICAL: Never hardcode shape dimensions.** Default sizes are too small for most text and will clip. You **must** dynamically size every shape to fit its text content using a measurement TextNode.

### How it works

Create a temporary TextNode with `textAutoResize: 'HEIGHT'`, use it to measure how tall text will be at a given width, and scale shapes up until the text fits. Remove the measurer when done.

### Utility code — include this in any code that creates shapes with text

```javascript
const NON_RECT_TYPES = new Set([
  'DIAMOND',
  'TRIANGLE_UP',
  'TRIANGLE_DOWN',
  'ELLIPSE',
  'HEXAGON',
  'OCTAGON',
  'STAR',
  'PENTAGON',
])
const BASE_W = 200
const BASE_H = 120
const MAX_SCALE = 3
const PADDING = 32

const measurer = figma.createText()
const SWT_FONT = { family: 'Inter', style: 'Medium' }
await figma.loadFontAsync(SWT_FONT)
measurer.fontName = SWT_FONT
measurer.textAutoResize = 'HEIGHT'

function textAreaForShape(shapeType, w, h) {
  if (NON_RECT_TYPES.has(shapeType)) {
    return { w: w / 2 - PADDING, h: h / 2 - PADDING }
  }
  return { w: w - PADDING * 2, h: h - PADDING * 2 }
}

function fitShapeToText(label, shapeType) {
  let w = BASE_W
  let h = BASE_H
  if (NON_RECT_TYPES.has(shapeType)) {
    w = Math.round(BASE_W * 1.6)
    h = Math.round(BASE_H * 1.6)
  }
  const origW = w,
    origH = h
  let scale = 1
  while (scale < MAX_SCALE) {
    const area = textAreaForShape(shapeType, w, h)
    measurer.resize(Math.max(area.w, 1), measurer.height)
    measurer.characters = label
    if (measurer.height <= area.h) break
    scale += 0.1
    w = Math.round(origW * scale)
    h = Math.round(origH * scale)
  }
  return { w, h }
}
```

Then for each shape, call `fitShapeToText(label, shapeType)` to get the right dimensions before calling `shape.resize(w, h)`. **Always call `measurer.remove()` after all shapes are created.**

## Rotation

**Only rotate shapes when the user explicitly asks for it.** Do not add rotation for visual flair — FigJam shapes should default to 0° rotation.

The `rotation` property sets degrees from -180 to 180, rotating around the top-left corner:

```javascript
const shape = await figma.getNodeByIdAsync('123:456')
if (shape && shape.type === 'SHAPE_WITH_TEXT') {
  shape.rotation = 45
}
figma.closePlugin()
```

## Opacity and Blend Mode

```javascript
const shape = figma.createShapeWithText()
await figma.loadFontAsync(shape.text.fontName)
shape.text.characters = 'Semi-transparent'

shape.opacity = 0.5
console.log('Opacity:', shape.opacity)

figma.closePlugin()
```

## Batch Creation: Row of Different Shapes

Uses the `fitShapeToText` utility from above to size each shape to its label:

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const DARK = h(0x1e, 0x1e, 0x1e)
const PRESETS = {
  lightGreen: { fill: h(0xcd, 0xf4, 0xd3), stroke: h(0x66, 0xd5, 0x75), text: DARK },
  lightBlue: { fill: h(0xc2, 0xe5, 0xff), stroke: h(0x3d, 0xad, 0xff), text: DARK },
  lightYellow: { fill: h(0xff, 0xec, 0xbd), stroke: h(0xff, 0xc9, 0x43), text: DARK },
  lightRed: { fill: h(0xff, 0xcd, 0xc2), stroke: h(0xff, 0x75, 0x56), text: DARK },
}

const items = [
  { label: 'Start', type: 'ROUNDED_RECTANGLE', color: PRESETS.lightGreen },
  { label: 'Process', type: 'SQUARE', color: PRESETS.lightBlue },
  { label: 'Decision', type: 'DIAMOND', color: PRESETS.lightYellow },
  { label: 'End', type: 'ELLIPSE', color: PRESETS.lightRed },
]
const spacing = 40

// ... include fitShapeToText utility code from above ...

const sizes = items.map((item) => fitShapeToText(item.label, item.type))
const totalWidth = sizes.reduce((sum, s) => sum + s.w, 0) + (items.length - 1) * spacing
let curX = 0

// All shapes share the same default font — load once before the loop
// instead of awaiting per-iteration.
const probe = figma.createShapeWithText()
await figma.loadFontAsync(probe.text.fontName)
probe.remove()
for (let i = 0; i < items.length; i++) {
  const size = sizes[i]
  const shape = figma.createShapeWithText()
  shape.shapeType = items[i].type
  shape.text.characters = items[i].label
  shape.resize(size.w, size.h)
  const preset = items[i].color
  shape.fills = [{ type: 'SOLID', color: preset.fill }]
  shape.strokes = [{ type: 'SOLID', color: preset.stroke }]
  shape.text.fills = [{ type: 'SOLID', color: preset.text }]
  shape.x = curX
  curX += size.w + spacing
}
measurer.remove()

figma.closePlugin()
```

## Cloning Shapes

```javascript
const original = await figma.getNodeByIdAsync('123:456')
if (original && original.type === 'SHAPE_WITH_TEXT') {
  const clone = original.clone()
  clone.x = original.x + original.width + 40
  console.log('Cloned shape:', clone.id, clone.shapeType)
}
figma.closePlugin()
```

## Key Points

- **Always wrap code in an async IIFE:** `(async () => { ... })();`
- **Always call `figma.closePlugin()`** at the end of every code path.
- **Follow the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids)** for `shape.text.characters` — always load `shape.text.fontName` (ShapeWithText defaults to `Inter Medium`, not Regular); never hardcode the family/style.
- **Connector text needs explicit font setup.** Unlike shapes, a ConnectorNode's `text.fontName` is invalid by default. To label a connector, first set `connector.text.fontName = { family: 'Inter', style: 'Medium' }` (font must already be loaded), then set `connector.text.characters`. Never call `figma.loadFontAsync(connector.text.fontName)` — it will fail.
- **Put ALL text content in `shape.text.characters`** — do not split into a short label and a separate description/metadata field. The shape should display the full text the user expects to see, and `fitShapeToText` will size it accordingly.
- **Never hardcode shape sizes. Always use `fitShapeToText`** to dynamically size shapes based on their text content. Create a measurer TextNode with `textAutoResize: 'HEIGHT'`, use it to measure text, scale shapes until text fits, then call `measurer.remove()`. This prevents text clipping.
- **Always set fill, stroke, AND text color together** using the color presets — setting only fills will leave mismatched stroke/text colors.
- **Set `shapeType` after creation:** `shape.shapeType = 'DIAMOND'` — use different types when the user asks for varied shapes.
- **Do not rotate** shapes unless the user explicitly asks for rotation.
- **Use `resize()`** not `resizeWithoutConstraints()` — shapes support `resize()` and `rescale()`.
- **Use node IDs** from the user message, not `figma.currentPage.selection`.
- **Verify changes** by logging before/after values and exporting images when supported.
