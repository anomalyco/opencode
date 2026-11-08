# Create Text Nodes

> Part of the [figma-use-figjam skill](../SKILL.md). Creating and styling standalone text nodes and mind map operations.

Use this skill when creating, modifying, or styling standalone text in FigJam (text created with the **Text** tool, not text inside stickies, shapes, or connectors). Also use this skill for mind map operations — adding, inserting, or extending connected text nodes.

**Scope:** Text nodes are created with `figma.createText()` and have type `'TEXT'`. For editing existing text content or mixed styles, see [edit-text](edit-text.md).

## When to use a Text Node

Use text nodes for titles, headers, labels, prompts, instructions, and any content that provides structure or context. They can also be used for longer descriptions or explanations.

## Creating a Text Node

```javascript
const text = figma.createText()

// Load the font before setting content (required for characters, fontSize, etc.)
await figma.loadFontAsync(text.fontName)
text.characters = 'Brainstorming instructions'

console.log('Created text:', text.id, text.characters)
figma.closePlugin()
```

## Text Wrapping and Width Constraints

By default, text nodes auto-resize in both width and height (`textAutoResize = 'WIDTH_AND_HEIGHT'`), meaning they never wrap — text extends in one line until it ends.

To make text wrap within a specific width (e.g., instructional text inside sections):

1. Set `textAutoResize = 'HEIGHT'` — text will grow vertically but respect the width constraint
2. Use `resize(width, height)` to set the desired width

   ```javascript
   const text = figma.createText()
   await figma.loadFontAsync(text.fontName)
   text.characters = 'Long instructional text that should wrap...'

   // Constrain to 336px wide, allow height to grow
   text.textAutoResize = 'HEIGHT'
   text.resize(336, text.height)
   ```

**When creating text inside sections**: Calculate the max width as `section.width - (padding * 2)`. For example, with 32px padding on each side:

```javascript
const maxWidth = section.width - 64 // 32px left + 32px right
text.textAutoResize = 'HEIGHT'
text.resize(maxWidth, text.height)
```

**Important**: Call `resize()` AFTER setting `characters` and `textAutoResize`, so the height adjusts correctly based on the wrapped content.

**When to wrap vs not**: Use text wrapping for body text and instructions inside sections. Leave headers and short labels at the default `WIDTH_AND_HEIGHT` so they size naturally — wrapping a short H1 title into a narrow column looks worse than letting it extend.

## Loading Fonts

**Critical:** Changing text content or any property that affects layout (e.g. `characters`, `fontSize`, `fontName`, `textCase`, `lineHeight`) requires the font to be loaded first. Call `figma.loadFontAsync(fontName)` before such operations.

- **Single font:** Use the node’s `fontName` (or the new font when changing font).
- **Mixed styles:** Text can have different fonts per range. Load every font used in the node:

```javascript
// Load all fonts in a text node (handles mixed fonts)
const segments = textNode.getStyledTextSegments(['fontName'])
await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))
```

Alternatively, for a given range:

```javascript
const fontNames = textNode.getRangeAllFontNames(0, textNode.characters.length)
await Promise.all(fontNames.map(figma.loadFontAsync))
```

You do **not** need to load a font to change only **fills** (text color), **strokes**, or similar paint-related properties.

## FigJam Preset Fonts

In FigJam, the font family control exposes four presets plus any custom fonts already in the selection. Prefer these preset fonts so created text matches what users see in the UI:

| Preset (UI label) | Font family    | Default style | Use for                |
| ----------------- | -------------- | ------------- | ---------------------- |
| Simple            | `Inter`        | `Medium`      | Default, readable body |
| Bookish           | `Merriweather` | `Regular`     | Serif, formal          |
| Technical         | `Roboto Mono`  | `Medium`      | Monospace, code        |
| Scribbled         | `Figma Hand`   | `Regular`     | Script, handwritten    |

Set `fontName` to match the FigJam UI: `{ family: 'Inter', style: 'Medium' }`, `{ family: 'Merriweather', style: 'Regular' }`, `{ family: 'Roboto Mono', style: 'Medium' }`, or `{ family: 'Figma Hand', style: 'Regular' }` (or the appropriate style for the font). Load the font before setting `characters` or `fontSize`.

## Missing Fonts

Check `textNode.hasMissingFont` before loading. If `true`, the font is not available in the document (e.g. not installed for the user). Avoid setting content or layout properties that require that font, or handle the case explicitly.

```javascript
const text = await figma.getNodeByIdAsync('123:456')
if (text && text.type === 'TEXT') {
  if (text.hasMissingFont) {
    console.warn('Text uses a missing font; cannot safely edit content.')
  } else {
    const segments = text.getStyledTextSegments(['fontName'])
    await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))
    text.characters = 'Updated text'
  }
}
figma.closePlugin()
```

## Color Palette

**CRITICAL**: When creating text for board templates, ALWAYS use the default **Charcoal (#1E1E1E)** color. Do not use grey (#757575, #B3B3B3) or light grey (#D9D9D9) for body text, headers, or descriptions — these make content look unfinished and hard to read.

In FigJam, text created with the **Text** tool uses a specific color palette. Prefer these colors so text matches FigJam’s default palette.

**CRITICAL:** Use `hex/255` notation (e.g. `0x1E/255`) for exact palette matching — rounded decimals can make FigJam treat the color as custom.

| Color        | Hex                   |
| ------------ | --------------------- |
| White        | `#FFFFFF`             |
| Black        | `#1E1E1E`             |
| Dark gray    | `#757575`             |
| Gray         | `#B3B3B3`             |
| Light gray   | `#D9D9D9`             |
| Green        | `#66D575`             |
| Light green  | `#CDF4D3`             |
| Teal         | `#5AD8CC`             |
| Light teal   | `#C6FAF6`             |
| Blue         | `#3DADFF`             |
| Light blue   | `#C2E5FF`             |
| Violet       | `#9747FF`             |
| Light violet | `#E4CCFF`             |
| Pink         | `#F849C1`             |
| Light pink   | `#FFC2EC`             |
| Red          | `#FF7556`             |
| Light red    | `#FFCDC2`             |
| Orange       | `#FF9E42`             |
| Light orange | `#FFE0C2`             |
| Yellow       | `#FFC943`             |
| Light yellow | `#FFECBD`             |
| Custom       | Any hex or eyedropper |

The default color for new text in FigJam is **Charcoal** (`#1E1E1E`). Use this for new text nodes unless the user specifies otherwise.

**Do not use color to create text hierarchy** — rely on font size (H1→64, H2→40, H3→24, body→16). All text MUST use Charcoal (#1E1E1E) unless the user specifically requests otherwise.

### Color Helper and Preset Map

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const FIGJAM_TEXT_COLORS = {
  white: h(0xff, 0xff, 0xff),
  black: h(0x1e, 0x1e, 0x1e), // Charcoal — default for new text
  darkGray: h(0x75, 0x75, 0x75),
  gray: h(0xb3, 0xb3, 0xb3),
  lightGray: h(0xd9, 0xd9, 0xd9),
  green: h(0x66, 0xd5, 0x75),
  lightGreen: h(0xcd, 0xf4, 0xd3),
  teal: h(0x5a, 0xd8, 0xcc),
  lightTeal: h(0xc6, 0xfa, 0xf6),
  blue: h(0x3d, 0xad, 0xff),
  lightBlue: h(0xc2, 0xe5, 0xff),
  violet: h(0x97, 0x47, 0xff),
  lightViolet: h(0xe4, 0xcc, 0xff),
  pink: h(0xf8, 0x49, 0xc1),
  lightPink: h(0xff, 0xc2, 0xec),
  red: h(0xff, 0x75, 0x56),
  lightRed: h(0xff, 0xcd, 0xc2),
  orange: h(0xff, 0x9e, 0x42),
  lightOrange: h(0xff, 0xe0, 0xc2),
  yellow: h(0xff, 0xc9, 0x43),
  lightYellow: h(0xff, 0xec, 0xbd),
}
```

### Setting Text Color

Set the text fill via the node’s `fills` property (after loading the font if you also change content):

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const text = figma.createText()
await figma.loadFontAsync(text.fontName)
text.characters = 'Blue label'
text.fills = [{ type: 'SOLID', color: h(0x3d, 0xad, 0xff) }] // Blue #3DADFF

figma.closePlugin()
```

### Changing Color on an Existing Text Node

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const text = await figma.getNodeByIdAsync('123:456')
if (text && text.type === 'TEXT') {
  // Fills can be set without loading the font
  text.fills = [{ type: 'SOLID', color: h(0x97, 0x47, 0xff) }] // Violet #9747FF
  console.log('Updated text color')
}
figma.closePlugin()
```

## Setting Text on an Existing Node

```javascript
const text = await figma.getNodeByIdAsync('123:456')
if (text && text.type === 'TEXT') {
  if (text.hasMissingFont) {
    console.warn('Missing font; skipping content update.')
  } else {
    const segments = text.getStyledTextSegments(['fontName'])
    await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))
    text.characters = 'New content'
  }
}
figma.closePlugin()
```

## FigJam Preset Font Sizes

The FigJam font size dropdown uses these preset values (in px). Prefer them so created text matches the UI options:

| Preset (UI label) | Size (px) |
| ----------------- | --------- |
| Small             | 16        |
| Medium            | 24        |
| Large             | 40        |
| Extra large       | 64        |
| Huge              | 96        |

Helper for use in code:

```javascript
const FIGJAM_FONT_SIZES = {
  small: 16,
  medium: 24,
  large: 40,
  extraLarge: 64,
  huge: 96,
}
```

Users can also pick custom sizes (e.g. 1–2000); the presets are the standard choices.

### Setting Size and Alignment

Load the font before changing layout-related properties:

```javascript
const text = figma.createText()
await figma.loadFontAsync(text.fontName)
text.characters = 'Heading'
text.fontSize = FIGJAM_FONT_SIZES.medium // 24 — matches FigJam "Medium"
text.textAlignHorizontal = 'CENTER'
text.textAlignVertical = 'CENTER'

figma.closePlugin()
```

## Bulleted and Numbered Lists

When creating content with numbered or bulleted lines, generate it line-by-line as a list by using `setRangeListOptions` and `setRangeIndentation` to properly render bullet points and numbers with indentation.

When creating lists with bullets or numbers, **do not** put literal bullet or number characters in the text (e.g. `"• Item 1\n• Item 2"` or `"1. First\n2. Second"`). Also **do not** build indentation in manually to items by including spaces (e.g. `    indented sub point`).

1. Set `characters` to the **content only** — one line per item, **no** leading `"• "`, `"1. "`, `A.`, `i.` or white space to manually create an indent.
2. Every line must have a list item type set, either 'ORDERED' for numbered/lettered lists, and 'UNORDERED' for bulleted lists. For each line that should be a list item, call **`setRangeListOptions(start, end, value)`** with the character range of that line (include the newline at the end of the line).
3. Every line must have an indentation level set. This is an integer **0–5**; use **1** for top-level list items. Use **`setRangeIndentation(start, end, level)`** to set this value for each line.

`setRangeListSpacing(start, end, value)` can optionally be used to add spacing between list items.
`getRangeListOptions(start, end)` or `getRangeIndentation(start, end)` can be used to inspect list options and indentation.

### Example: Numbered list

```javascript
const text = figma.createText()
await figma.loadFontAsync(text.fontName)

// Content only — no number characters. Each entry: [line content, indentation level 0–5]
const items = [
  ['First main point', 1],
  ['Sub-point under first', 2],
  ['Sub-sub-point', 3],
  ['Second main point', 1],
  ['Sub-point under second', 2],
]

const lines = items.map(([content]) => content)
text.characters = lines.join('\n')

let offset = 0
for (let i = 0; i < items.length; i++) {
  const [content, indentLevel] = items[i]
  const start = offset
  // Only add +1 for newline if NOT the last line
  const end = offset + content.length + (i < lines.length - 1 ? 1 : 0)
  text.setRangeListOptions(start, end, { type: 'ORDERED' })
  text.setRangeIndentation(start, end, indentLevel)
  offset = end
}

figma.closePlugin()
```

### Example: Bulleted list

```javascript
const text = figma.createText()
await figma.loadFontAsync(text.fontName)

// Each entry: [line content, indentation level 0–5]
const items = [
  ['Top-level item', 1],
  ['Nested under first', 2],
  ['Deeper nested', 3],
  ['Sibling at level 2', 2],
  ['Second top-level item', 1],
  ['Its nested child', 2],
]

const lines = items.map(([content]) => content)
text.characters = lines.join('\n')

let offset = 0
for (let i = 0; i < items.length; i++) {
  const [content, indentLevel] = items[i]
  const start = offset
  // Only add +1 for newline if NOT the last line
  const end = offset + content.length + (i < lines.length - 1 ? 1 : 0)
  text.setRangeListOptions(start, end, { type: 'UNORDERED' })
  text.setRangeIndentation(start, end, indentLevel)
  offset = end
}

figma.closePlugin()
```

## Cloning Text Nodes

```javascript
const original = await figma.getNodeByIdAsync('123:456')
if (original && original.type === 'TEXT') {
  const clone = original.clone()
  clone.x = original.x + original.width + 20
  console.log('Cloned text:', clone.id)
}
figma.closePlugin()
```

### Modifying existing structures (mind maps, connected text)

Mind maps and similar structures use text nodes connected by connectors. When adding or inserting nodes, you must **shift existing nodes to make room** — otherwise nodes will overlap.

**Shift direction depends on the layout:**

- **Left-to-right flows:** shift downstream nodes along the **x-axis**
- **Tree / mind map branches:** shift sibling nodes along the **y-axis** — branches spread vertically, so new children need vertical space

#### Adding child nodes to a mind map branch

When adding multiple child nodes to a branch point, space each child vertically and shift any existing siblings below them downward:

```javascript
const branchNode = await figma.getNodeByIdAsync(branchNodeId)
const parent = branchNode.parent

const newTopics = ['Topic A', 'Topic B', 'Topic C']
const Y_SPACING = 40

// Measure total height the new nodes will need.
// Each newly created text node uses the same default font, so load it once
// before the loop rather than awaiting per-iteration.
const probe = figma.createText()
await figma.loadFontAsync(probe.fontName)
probe.remove()
const newTexts = []
for (const topic of newTopics) {
  const t = figma.createText()
  t.characters = topic
  newTexts.push(t)
}
const totalNewHeight =
  newTexts.reduce((sum, t) => sum + t.height, 0) + (newTexts.length - 1) * Y_SPACING

// Shift existing sibling nodes below the insertion point downward
for (const sibling of parent.children) {
  if (sibling.type === 'TEXT' && sibling.y > branchNode.y) {
    sibling.y += totalNewHeight + Y_SPACING
  }
}

// Place new nodes vertically, connected to the branch point
let curY = branchNode.y + branchNode.height + Y_SPACING
for (const t of newTexts) {
  parent.appendChild(t)
  t.x = branchNode.x - t.width - 80
  t.y = curY

  const conn = figma.createConnector()
  conn.connectorStart = { endpointNodeId: t.id, magnet: 'AUTO' }
  conn.connectorEnd = { endpointNodeId: branchNode.id, magnet: 'AUTO' }
  conn.connectorStartStrokeCap = 'NONE'
  conn.connectorEndStrokeCap = 'ARROW_LINES'
  parent.appendChild(conn)

  curY += t.height + Y_SPACING
}
```

#### Inserting a text node into a linear chain

For left-to-right connected text (not tree-shaped), shift downstream nodes horizontally:

```javascript
const leftNode = await figma.getNodeByIdAsync(leftNodeId)
const rightNode = await figma.getNodeByIdAsync(rightNodeId)
const oldConnector = await figma.getNodeByIdAsync(connectorId)
const parent = leftNode.parent

const newText = figma.createText()
await figma.loadFontAsync(newText.fontName)
newText.characters = 'New Topic'

// Shift nodes to the right to make room
const SPACING = 80
const shiftAmount = newText.width + SPACING
for (const sibling of parent.children) {
  if (sibling.type === 'TEXT' && sibling.x >= rightNode.x) {
    sibling.x += shiftAmount
  }
}

// Place the new node in the created gap
parent.appendChild(newText)
newText.x = leftNode.x + leftNode.width + SPACING / 2
newText.y = leftNode.y

// Rewire connectors
oldConnector.remove()
const conn1 = figma.createConnector()
conn1.connectorStart = { endpointNodeId: leftNode.id, magnet: 'AUTO' }
conn1.connectorEnd = { endpointNodeId: newText.id, magnet: 'AUTO' }
conn1.connectorStartStrokeCap = 'NONE'
conn1.connectorEndStrokeCap = 'ARROW_LINES'
parent.appendChild(conn1)

const conn2 = figma.createConnector()
conn2.connectorStart = { endpointNodeId: newText.id, magnet: 'AUTO' }
conn2.connectorEnd = { endpointNodeId: rightNode.id, magnet: 'AUTO' }
conn2.connectorStartStrokeCap = 'NONE'
conn2.connectorEndStrokeCap = 'ARROW_LINES'
parent.appendChild(conn2)
```

If the parent is a section, resize it afterward to encompass the new content (see [create-section](create-section.md) — "Resizing an Existing Section").

## Key Points

- **Always wrap code in an async IIFE:** `(async () => { ... })();`
- **Always call `figma.closePlugin()`** at the end of every code path.
- **Follow the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids)** for `characters`, `fontSize`, `fontName`, or any property that affects layout; not required for `fills` (color) only.
- **Check `hasMissingFont`** when editing existing text; do not assume fonts are available.
- **Use node IDs** from the user message, not `figma.currentPage.selection`.
- **Use the FigJam palette** with `hex/255` for text color.
- **Prefer FigJam font presets** (Inter, Merriweather, Roboto Mono, Figma Hand — UI labels: Simple, Bookish, Technical, Scribbled) and **preset font sizes** (16, 24, 40, 64, 96) so created text aligns with the font and size dropdowns in the UI.
- **For bulleted/numbered lists:** use `setRangeListOptions` and `setRangeIndentation` on line ranges; do not embed bullet or number characters in the text if it will be formatted as an ordered or unordered list.
- **Verify changes** by logging before/after values and exporting images when supported.
