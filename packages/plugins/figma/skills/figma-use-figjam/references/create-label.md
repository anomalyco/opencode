# Create Label Nodes

> Part of the [figma-use-figjam skill](../SKILL.md). Creating small circle callout markers with a number or letter.

**Scope:** Label nodes are small fixed-size circle shapes containing a single number or letter, used as callout markers, step indicators, or annotation anchors on a FigJam board. They are created with `figma.createShapeWithText()` using `shapeType = 'ELLIPSE'` and a fixed size. For shapes that need to fit longer text content, see [create-shape-with-text](create-shape-with-text.md).

**When to use labels:** Annotating steps in a process, numbering items on a diagram, marking locations on a map or wireframe, or providing lettered callouts that reference an accompanying legend.

**When NOT to use labels:** If the content is more than 2 characters (e.g. a word or phrase), use a regular [shape-with-text](create-shape-with-text.md) instead.

## Creating a Label

```javascript
// Position the label — determine a location relative to existing content
const labelLocation = { x: 100, y: 100 }

const label = figma.createShapeWithText()
label.shapeType = 'ELLIPSE'

await figma.loadFontAsync(label.text.fontName)
label.text.characters = '1'

// Labels use a fixed size — do NOT use fitShapeToText
label.resize(48, 48)
label.text.fontSize = 20

label.x = labelLocation.x
label.y = labelLocation.y

figma.currentPage.appendChild(label)
return { id: label.id, x: label.x, y: label.y }
```

## Size

Labels use **fixed dimensions** — do not use `fitShapeToText` (that utility is for shapes with variable-length text).

| Content                | Width × Height | Font size |
| ---------------------- | -------------- | --------- |
| Single char (`1`, `A`) | 48 × 48        | 20        |
| Two chars (`10`, `AB`) | 64 × 64        | 20        |

Both width and height must always be equal (square bounding box) so the ellipse renders as a perfect circle.

## Color Presets

Labels use the same coordinated fill/stroke/text color system as other FigJam shapes. Always set all three together. Use `hex/255` notation for exact palette matching — rounded decimals cause FigJam to treat the color as "custom". For the canonical palette across all FigJam node types, see [figjam-colors](figjam-colors.md).

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const DARK = h(0x1e, 0x1e, 0x1e)

const LABEL_COLOR_PRESETS = {
  black: { fill: h(0x1e, 0x1e, 0x1e), stroke: h(0xb3, 0xb3, 0xb3), text: WHITE },
  darkGray: { fill: h(0x75, 0x75, 0x75), stroke: h(0x5e, 0x5e, 0x5e), text: WHITE },
  green: { fill: h(0x66, 0xd5, 0x75), stroke: h(0x3e, 0x9b, 0x4b), text: WHITE },
  teal: { fill: h(0x5a, 0xd8, 0xcc), stroke: h(0x36, 0x9e, 0x94), text: WHITE },
  blue: { fill: h(0x3d, 0xad, 0xff), stroke: h(0x00, 0x7a, 0xd2), text: WHITE },
  violet: { fill: h(0x87, 0x4f, 0xff), stroke: h(0x54, 0x27, 0xb4), text: WHITE },
  pink: { fill: h(0xf8, 0x49, 0xc1), stroke: h(0xb4, 0x24, 0x87), text: WHITE },
  red: { fill: h(0xff, 0x75, 0x56), stroke: h(0xdc, 0x30, 0x09), text: WHITE },
  orange: { fill: h(0xff, 0x9e, 0x42), stroke: h(0xeb, 0x75, 0x00), text: WHITE },
  gray: { fill: h(0xb3, 0xb3, 0xb3), stroke: h(0x8f, 0x8f, 0x8f), text: DARK },
  lightGray: { fill: h(0xd9, 0xd9, 0xd9), stroke: h(0xb3, 0xb3, 0xb3), text: DARK },
  yellow: { fill: h(0xff, 0xc9, 0x43), stroke: h(0xe8, 0xa3, 0x02), text: DARK },
  white: { fill: h(0xff, 0xff, 0xff), stroke: h(0xb3, 0xb3, 0xb3), text: DARK },
}

function applyLabelColor(label, preset) {
  label.fills = [{ type: 'SOLID', color: preset.fill }]
  label.strokes = [{ type: 'SOLID', color: preset.stroke }]
  label.text.fills = [{ type: 'SOLID', color: preset.text }]
}
```

### Applying a color

```javascript
const label = figma.createShapeWithText()
label.shapeType = 'ELLIPSE'
await figma.loadFontAsync(label.text.fontName)
label.text.characters = '1'
label.resize(48, 48)
label.text.fontSize = 20
applyLabelColor(label, LABEL_COLOR_PRESETS.blue)

figma.closePlugin()
```

## Batch Creation: Numbered Sequence

The most common use case is a horizontal row of numbered labels. Use a two-pass layout: create all labels first, then position them using their actual dimensions.

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const PRESET_BLUE = { fill: h(0x3d, 0xad, 0xff), stroke: h(0x00, 0x7a, 0xd2), text: WHITE }

const count = 5
const size = 48
const spacing = 16
const labelLocation = { x: 100, y: 100 }

// Pass 1: create all labels.
// All labels share the same default font — load once before the loop instead
// of awaiting per-iteration.
const probe = figma.createShapeWithText()
await figma.loadFontAsync(probe.text.fontName)
probe.remove()
const labels = []
for (let i = 1; i <= count; i++) {
  const label = figma.createShapeWithText()
  label.shapeType = 'ELLIPSE'
  label.text.characters = String(i)
  label.resize(size, size)
  label.text.fontSize = 20
  label.fills = [{ type: 'SOLID', color: PRESET_BLUE.fill }]
  label.strokes = [{ type: 'SOLID', color: PRESET_BLUE.stroke }]
  label.text.fills = [{ type: 'SOLID', color: PRESET_BLUE.text }]
  labels.push(label)
}

// Pass 2: position in a horizontal row
let curX = labelLocation.x
for (const label of labels) {
  label.x = curX
  label.y = labelLocation.y
  curX += size + spacing
}

return labels.map((l) => ({ id: l.id }))
```

## Batch Creation: Lettered Sequence

Same two-pass pattern as the numbered sequence, using `String.fromCharCode` to generate A, B, C…

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const PRESET_VIOLET = { fill: h(0x87, 0x4f, 0xff), stroke: h(0x54, 0x27, 0xb4), text: WHITE }

const letters = ['A', 'B', 'C', 'D', 'E']

const size = 48
const spacing = 16
const labelLocation = { x: 100, y: 100 }

// Pass 1: create all labels.
// All labels share the same default font — load once before the loop instead
// of awaiting per-iteration.
const probe = figma.createShapeWithText()
await figma.loadFontAsync(probe.text.fontName)
probe.remove()
const labels = []
for (const letter of letters) {
  const label = figma.createShapeWithText()
  label.shapeType = 'ELLIPSE'
  label.text.characters = letter
  label.resize(size, size)
  label.text.fontSize = 20
  label.fills = [{ type: 'SOLID', color: PRESET_VIOLET.fill }]
  label.strokes = [{ type: 'SOLID', color: PRESET_VIOLET.stroke }]
  label.text.fills = [{ type: 'SOLID', color: PRESET_VIOLET.text }]
  labels.push(label)
}

// Pass 2: position in a horizontal row
let curX = labelLocation.x
for (const label of labels) {
  label.x = curX
  label.y = labelLocation.y
  curX += size + spacing
}

return labels.map((l) => ({ id: l.id }))
```

## Positioning Relative to an Existing Node

Labels are most often placed adjacent to the node they're annotating. Use the target node's bounds to derive `labelLocation`:

```javascript
// Place a label at the top-right corner of an existing node
const targetNode = figma.getNodeById(targetNodeId)
if (!targetNode) throw new Error('Node not found')

const label = figma.createShapeWithText()
label.shapeType = 'ELLIPSE'
await figma.loadFontAsync(label.text.fontName)
label.text.characters = '1'
label.resize(48, 48)
label.text.fontSize = 20

// Top-left corner, offset so the label overlaps the corner slightly
label.x = targetNode.x - label.width / 2
label.y = targetNode.y - label.height / 2

figma.currentPage.appendChild(label)
return { id: label.id }
```

## Label + Sticky Legend

When annotations need descriptive text (e.g. "1. Introduction", "A. Problem statement"), place label circles on or near the target nodes as markers, then group the corresponding stickies in a cluster nearby — offset 200–300px below (or to the side of) the labeled content. The stickies act as a legend; the labels are the pins. Do NOT place the sticky immediately adjacent to its label circle — if they're glued together there's no need for the circle at all.

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const PRESET_BLUE = { fill: h(0x3d, 0xad, 0xff), stroke: h(0x00, 0x7a, 0xd2), text: WHITE }

const annotations = [
  { number: '1', text: 'Introduction' },
  { number: '2', text: 'Problem statement' },
  { number: '3', text: 'Proposed solution' },
]

// targetNodes: the nodes being annotated, one per annotation
// (derive from node IDs passed in the user message)

// Pre-load the label and sticky default fonts in parallel — both fonts are
// the same for every iteration, so awaiting inside the loop would needlessly
// serialize the work.
const labelProbe = figma.createShapeWithText()
const stickyProbe = figma.createSticky()
await Promise.all([
  figma.loadFontAsync(labelProbe.text.fontName),
  figma.loadFontAsync(stickyProbe.text.fontName),
])
labelProbe.remove()
stickyProbe.remove()

// Pass 1: create labels and stickies
const pairs = []
for (const item of annotations) {
  const label = figma.createShapeWithText()
  label.shapeType = 'ELLIPSE'
  label.text.characters = item.number
  label.resize(48, 48)
  label.text.fontSize = 20
  label.fills = [{ type: 'SOLID', color: PRESET_BLUE.fill }]
  label.strokes = [{ type: 'SOLID', color: PRESET_BLUE.stroke }]
  label.text.fills = [{ type: 'SOLID', color: PRESET_BLUE.text }]

  const sticky = figma.createSticky()
  sticky.text.characters = `${item.number}. ${item.text}`

  pairs.push({ label, sticky })
}

// Pass 2: place labels on their target nodes (top-left corner)
for (let i = 0; i < pairs.length; i++) {
  const targetNode = targetNodes[i]
  pairs[i].label.x = targetNode.x - 24
  pairs[i].label.y = targetNode.y - 24
}

// Pass 3: cluster stickies in a vertical column to the right of the labeled content.
// Use the right edge of the target nodes as the anchor, then push further right past
// any existing nodes that overlap vertically with the legend area.
const targetRight = Math.max(...targetNodes.map((n) => n.x + n.width))
const targetTop = Math.min(...targetNodes.map((n) => n.y))
const targetBottom = Math.max(...targetNodes.map((n) => n.y + n.height))

// Find the rightmost edge of any page node that overlaps vertically with the legend area
const legendGap = 250
const conflictRight = figma.currentPage.children
  .filter((n) => n.y < targetBottom + legendGap && n.y + n.height > targetTop)
  .reduce((max, n) => Math.max(max, n.x + n.width), targetRight)

const legendX = conflictRight + legendGap
const stickySpacing = 32
let curY = targetTop
for (const { sticky } of pairs) {
  sticky.x = legendX
  sticky.y = curY
  curY += sticky.height + stickySpacing
}

return pairs.map(({ label, sticky }) => ({ labelId: label.id, stickyId: sticky.id }))
```

## Key Points

- **Always wrap code in an async IIFE:** `(async () => { ... })();`
- **Always call `figma.closePlugin()`** at the end of every code path.
- **Follow the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids)** for `label.text.characters` — always load `label.text.fontName` dynamically; never hardcode the family/style.
- **Use fixed size — do NOT use `fitShapeToText`.** Labels are compact by design; their size is fixed at 48×48 (single char) or 64×64 (two chars).
- **Width must equal height** so the ELLIPSE renders as a perfect circle.
- **Set `fontSize` explicitly** after loading the font to ensure the character is legible in the small circle.
- **Set fill, stroke, AND text color together** — setting only fills leaves mismatched stroke/text colors.
- **Use `shapeType = 'ELLIPSE'`** — the default shapeType is also `'ELLIPSE'`, but set it explicitly for clarity.
- **Use node IDs** from the user message, not `figma.currentPage.selection`.
