# Create Sticky Notes

> Part of the [figma-use-figjam skill](../SKILL.md). Creating, modifying, and styling sticky notes.

**Scope:** Sticky notes are FigJam-specific nodes created with `figma.createSticky()`. For advanced text formatting on stickies, see [edit-text](edit-text.md).

## When to use a Sticky

Use sticky notes for individual ideas, responses, or pieces of input — keep each sticky to one idea.

Do not use stickies for prompts, instructions, guiding questions, labels, or pre-written analysis — even if the content is short. If the content is there to guide or inform, use a text node instead.

For an interactive board, you can also think of a sticky as something an active participant or collaborator would have placed, whereas text is often a part of the board's structure.

## Creating a Sticky

```javascript
const sticky = figma.createSticky()

// Load the font before setting text content
await figma.loadFontAsync(sticky.text.fontName)
sticky.text.characters = 'Hello from FigJam!'

console.log('Created sticky:', sticky.id, sticky.text.characters)
figma.closePlugin()
```

## Setting Text

Stickies expose a `text` sublayer (a `TextSublayerNode`). You must load fonts before changing text content:

```javascript
const sticky = figma.createSticky()

// Load the font used by the sticky's text sublayer
await figma.loadFontAsync(sticky.text.fontName)
sticky.text.characters = 'Updated text'

figma.closePlugin()
```

To modify text on an existing sticky:

```javascript
const sticky = await figma.getNodeByIdAsync('123:456')
if (sticky && sticky.type === 'STICKY') {
  await figma.loadFontAsync(sticky.text.fontName)
  sticky.text.characters = 'New content'
}
figma.closePlugin()
```

## Color Palette

FigJam sticky notes use a fixed palette of 10 colors. Set via the `fills` property. For the canonical palette across all FigJam node types, see [figjam-colors](figjam-colors.md).

**CRITICAL**: Use `hex/255` notation (e.g. `0xA8/255`) for exact palette matching — rounded decimals cause FigJam to treat the color as "custom" instead of a palette color.

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

### Setting a Sticky's Color

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const sticky = figma.createSticky()
await figma.loadFontAsync(sticky.text.fontName)
sticky.text.characters = 'Blue sticky'
sticky.fills = [{ type: 'SOLID', color: h(0xa8, 0xda, 0xff) }] // Blue #A8DAFF

figma.closePlugin()
```

### Changing the Color of an Existing Sticky

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const sticky = await figma.getNodeByIdAsync('123:456')
if (sticky && sticky.type === 'STICKY') {
  console.log('Before:', JSON.stringify(sticky.fills))
  sticky.fills = [{ type: 'SOLID', color: h(0xff, 0xe2, 0x99) }] // Yellow #FFE299
  console.log('After:', JSON.stringify(sticky.fills))
}
figma.closePlugin()
```

## Sizing

Stickies have two shapes controlled by `isWideWidth`:

- **Square** (default): `isWideWidth = false` — **240 × 240 px**
- **Wide rectangular**: `isWideWidth = true` — **416 × 240 px**

The `width` and `height` properties are **read-only**. Stickies do not support `resize()` — use `isWideWidth` to toggle between square and wide shapes.

**Auto-grow:** Stickies automatically grow taller when text overflows the default height. The width stays fixed (240 or 416), but height can exceed 240. When positioning multiple stickies, always read the actual `sticky.height` after setting text — don't assume 240.

Default to square stickies; only use wide stickies if the text is approximately 100 words or more.

```javascript
const sticky = figma.createSticky()
await figma.loadFontAsync(sticky.text.fontName)
sticky.text.characters = 'Wide sticky'
sticky.isWideWidth = true

console.log('Size:', sticky.width, 'x', sticky.height)
// Square: 240 x 240 (or taller if text overflows)
// Wide:   416 x 240 (or taller if text overflows)
figma.closePlugin()
```

### Toggling Size on an Existing Sticky

```javascript
const sticky = await figma.getNodeByIdAsync('123:456')
if (sticky && sticky.type === 'STICKY') {
  console.log('Before:', sticky.width, 'x', sticky.height, 'wide:', sticky.isWideWidth)
  sticky.isWideWidth = !sticky.isWideWidth
  console.log('After:', sticky.width, 'x', sticky.height, 'wide:', sticky.isWideWidth)
}
figma.closePlugin()
```

## Layout & Spacing (REQUIRED for batch creation)

**Use a grid, not a vertical stack.** When placing multiple stickies inside a section, arrange them in a **grid** (cols × rows) with 64 px spacing — do not stack them in a single column. See "Grid of Stickies" below.

**CRITICAL — Two-pass layout:** When creating multiple stickies, you MUST use a two-pass approach. Measuring one sticky and assuming all are the same size **will cause overlapping**.

**Pass 1 — Create all stickies:** Create every sticky, set its text and color. Do NOT position yet.

**Pass 2 — Position using actual dimensions:** Read each sticky's real `.width` and `.height`, compute per-row max heights, then assign x/y coordinates.

**Row-based positioning for grids:** When laying out stickies in a grid, position each row independently. Within a row, place stickies left-to-right using each sticky's actual `.width` plus uniform spacing. Rows should align vertically (use per-row max height for the y offset), but columns do NOT need to align across rows. This keeps uniform gaps between stickies even when widths vary (e.g., mixing square and wide stickies).

**Recommended spacing:** 20px minimum between stickies at all times. Use 30–40px for more breathing room. Default to 64px when laying out stickies in a grid pattern.

## Author Properties

Prefer to keep author visible unless explicitly prompted otherwise.

```javascript
const sticky = figma.createSticky()
await figma.loadFontAsync(sticky.text.fontName)
sticky.text.characters = 'Team feedback'

// The author is automatically set to the current user on creation
console.log('Author:', sticky.authorName)

// Hide or show the author label
sticky.authorVisible = false

figma.closePlugin()
```

## Batch Creation

### Row of Stickies

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const labels = ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']
const colors = [
  h(0xb3, 0xef, 0xbd), // Green #B3EFBD
  h(0xa8, 0xda, 0xff), // Blue #A8DAFF
  h(0xff, 0xa8, 0xdb), // Pink #FFA8DB
  h(0xff, 0xe2, 0x99), // Yellow #FFE299
]
const spacing = 64

// Pass 1: Create all stickies and set content.
// Every sticky uses the same default font, so load it once before the loop
// rather than awaiting per-iteration.
const probe = figma.createSticky()
await figma.loadFontAsync(probe.text.fontName)
probe.remove()
const stickies = []
for (let i = 0; i < labels.length; i++) {
  const sticky = figma.createSticky()
  sticky.text.characters = labels[i]
  sticky.fills = [{ type: 'SOLID', color: colors[i % colors.length] }]
  stickies.push(sticky)
}

// Pass 2: Position using each sticky's actual width and height
const totalWidth = stickies.reduce((sum, s) => sum + s.width, 0) + (stickies.length - 1) * spacing
const maxH = Math.max(...stickies.map((s) => s.height))
let curX = 0
for (const sticky of stickies) {
  sticky.x = curX
  curX += sticky.width + spacing
}

figma.closePlugin()
```

### Grid of Stickies

Rows align vertically, but columns don't need to line up — each row flows left-to-right with uniform spacing.

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const items = ['Task A', 'Task B', 'Task C', 'Task D', 'Task E', 'Task F']
const cols = 3
const spacing = 64

// Pass 1: Create all stickies and set content.
// All stickies share the same default font — load once outside the loop
// instead of awaiting per-iteration.
const probe = figma.createSticky()
await figma.loadFontAsync(probe.text.fontName)
probe.remove()
const stickies = []
for (let i = 0; i < items.length; i++) {
  const sticky = figma.createSticky()
  sticky.text.characters = items[i]
  sticky.fills = [{ type: 'SOLID', color: h(0xff, 0xe2, 0x99) }] // Yellow #FFE299
  stickies.push(sticky)
}

// Pass 2: Group into rows, compute per-row dimensions
const numRows = Math.ceil(stickies.length / cols)
const rowGroups = []
for (let r = 0; r < numRows; r++) {
  rowGroups.push(stickies.slice(r * cols, r * cols + cols))
}
const rowHeights = rowGroups.map((row) => Math.max(...row.map((s) => s.height)))
// Position each row independently
let curY = 0
for (let r = 0; r < rowGroups.length; r++) {
  let curX = 0
  for (const sticky of rowGroups[r]) {
    sticky.x = curX
    sticky.y = curY
    curX += sticky.width + spacing
  }
  curY += rowHeights[r] + spacing
}

figma.closePlugin()
```

## Cloning Stickies

```javascript
const original = await figma.getNodeByIdAsync('123:456')
if (original && original.type === 'STICKY') {
  const clone = original.clone()
  clone.x = original.x + original.width + 64
  console.log('Cloned sticky:', clone.id)
}
figma.closePlugin()
```

### Replacing a node with a sticky

Copy the source node's position, add the sticky to the same parent, then remove the original:

```javascript
const source = await figma.getNodeByIdAsync(nodeId)
const sticky = figma.createSticky()
await figma.loadFontAsync(sticky.text.fontName)
sticky.text.characters = source.text.characters

// Reparent into the same container so x/y are in the same coordinate space
source.parent.appendChild(sticky)
sticky.x = source.x
sticky.y = source.y

source.remove()
```

### Creating stickies near an existing node

Please see [position-figjam-nodes](position-figjam-nodes.md) - "Positioning Nodes Relative to Existing Nodes"

## Key Points

- **Always wrap code in an async IIFE:** `(async () => { ... })();`
- **Always call `figma.closePlugin()`** at the end of every code path.
- **Follow the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids)** for `sticky.text.characters` — load `sticky.text.fontName` (FigJam sticky default is `Inter Medium`, not Inter Regular), `await`, mutate, return IDs.
- **Use node IDs** from the user message, not `figma.currentPage.selection`.
- **Verify changes** by logging before/after values and exporting images when supported.
