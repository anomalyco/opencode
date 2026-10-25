# Text Operations

> Part of the [figma-use-figjam skill](../SKILL.md). Editing existing text content, styles, and font segments.

## Critical: Load Fonts First

Follow the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids) — load font → `await` → mutate → return affected IDs. Skipping the load throws `Cannot write to node with unloaded font "<family> <style>"`. Inter is preloaded in most environments; every other family (and every Inter style you haven't already loaded) still needs an explicit `loadFontAsync`.

```javascript
// Load a single font
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })

// Load a font used by a single-font text node
await figma.loadFontAsync(textNode.fontName)

// Load all fonts in a text node (handles mixed fonts via styled segments)
const segments = textNode.getStyledTextSegments(['fontName'])
await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))
```

## Complete Working Example

```javascript
const nodeId = '123:456'
const node = await figma.getNodeByIdAsync(nodeId)

if (node && node.type === 'TEXT') {
  // Load all fonts used in this text node (handles mixed fonts via styled segments)
  const segments = node.getStyledTextSegments(['fontName'])
  await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))

  console.log('Before:', node.characters)
  node.characters = 'New text content'
  console.log('After:', node.characters)

  // Verify with image
  const img = await node.exportAsync({
    format: 'PNG',
    constraint: { type: node.width > node.height ? 'WIDTH' : 'HEIGHT', value: 128 },
  })
  figma.io.write(`${node.name.replace(/[^a-z0-9]/gi, '_')}_result.png`, img)
}
figma.closePlugin()
```

## Basic Properties

Follows the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids) — load every (family, style) you're about to assign (including the NEW font when changing `fontName`) before any text mutation.

```javascript
// Required for any font, not just Inter
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })

// Text content
textNode.characters = 'Hello, World!'

// Font
textNode.fontName = { family: 'Inter', style: 'Bold' }

// Size
textNode.fontSize = 16

// Color (via fills) — use Charcoal (#1E1E1E) as default
textNode.fills = [{ type: 'SOLID', color: { r: 0x1e / 255, g: 0x1e / 255, b: 0x1e / 255 } }]
```

### Text Color in FigJam

**CRITICAL**: When editing text in FigJam board content (templates, brainstorms, retros, or any generated content), always use **Charcoal (#1E1E1E)** as the text color unless the user has specifically requested different colors. Use `hex/255` notation for exact palette matching. For non-text node colors and the canonical palette across all FigJam node types, see [figjam-colors](figjam-colors.md).

```javascript
// Charcoal — default for all FigJam text
textNode.fills = [{ type: 'SOLID', color: { r: 0x1e / 255, g: 0x1e / 255, b: 0x1e / 255 } }]
```

Do not use grey (#757575, #B3B3B3) or light grey (#D9D9D9) for body text, headers, or descriptions — these make content look unfinished and hard to read.

## Text Alignment

```javascript
// Horizontal alignment
textNode.textAlignHorizontal = 'LEFT' // LEFT, CENTER, RIGHT, JUSTIFIED

// Vertical alignment
textNode.textAlignVertical = 'TOP' // TOP, CENTER, BOTTOM
```

## Line Height and Spacing

```javascript
// Line height
textNode.lineHeight = { value: 150, unit: 'PERCENT' }
textNode.lineHeight = { value: 24, unit: 'PIXELS' }
textNode.lineHeight = { unit: 'AUTO' }

// Letter spacing
textNode.letterSpacing = { value: 0, unit: 'PERCENT' }
textNode.letterSpacing = { value: 1, unit: 'PIXELS' }

// Paragraph spacing
textNode.paragraphSpacing = 16

// Paragraph indentation
textNode.paragraphIndent = 24
```

## Text Decoration

Underlines and strikethroughs support styling (wavy, dotted), offset, and color.

```javascript
textNode.textDecoration = 'UNDERLINE' // NONE, UNDERLINE, STRIKETHROUGH
textNode.textDecorationStyle = 'WAVY' // SOLID, DOTTED, WAVY
textNode.textDecorationOffset = { unit: 'PIXELS', value: 2 }
textNode.textDecorationColor = { value: { type: 'SOLID', color: { r: 1, g: 0, b: 0 } } } // Custom color
textNode.textDecorationColor = { value: 'AUTO' } // Inherit from text color
```

## Text Case

```javascript
// Case transformation
textNode.textCase = 'ORIGINAL' // ORIGINAL, UPPER, LOWER, TITLE, SMALL_CAPS, SMALL_CAPS_FORCED
```

## Text Sizing Behavior

```javascript
// Auto-resize mode
textNode.textAutoResize = 'WIDTH_AND_HEIGHT' // Auto-size both
textNode.textAutoResize = 'HEIGHT' // Fixed width, auto height
textNode.textAutoResize = 'NONE' // Fixed size
// Truncation pattern (preferred over deprecated textAutoResize = 'TRUNCATE')
textNode.textAutoResize = 'NONE' // Keep fixed bounds
textNode.textTruncation = 'ENDING' // Truncate overflow with ellipsis
textNode.maxLines = 2 // Optional: cap visible lines
```

## Styled Ranges (Mixed Styles)

For text with different styles in different parts:

```javascript
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })

textNode.characters = 'Hello World'

// Make "Hello" bold (characters 0-5)
textNode.setRangeFontName(0, 5, { family: 'Inter', style: 'Bold' })

// Make "World" red (characters 6-11)
textNode.setRangeFills(6, 11, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }])

// Change size of "World"
textNode.setRangeFontSize(6, 11, 24)

// Get properties for a range
const fontAtStart = textNode.getRangeFontName(0, 1)
const sizeAtEnd = textNode.getRangeFontSize(10, 11)
```

## Available Range Methods

- `setRangeFontName(start, end, fontName)`
- `setRangeFontSize(start, end, size)`
- `setRangeFills(start, end, fills)`
- `setRangeTextDecoration(start, end, decoration)`
- `setRangeTextCase(start, end, textCase)`
- `setRangeLetterSpacing(start, end, spacing)`
- `setRangeLineHeight(start, end, lineHeight)`
- `setRangeHyperlink(start, end, hyperlink)`
- `setRangeListOptions(start, end, listOptions)`
- `setRangeIndentation(start, end, indentation)`

## Hyperlinks

```javascript
// Set hyperlink
textNode.setRangeHyperlink(0, 5, { type: 'URL', value: 'https://figma.com' })

// Node link
textNode.setRangeHyperlink(0, 5, { type: 'NODE', value: '123:456' })

// Remove hyperlink
textNode.setRangeHyperlink(0, 5, null)
```

## Lists

```javascript
// Bulleted list
textNode.setRangeListOptions(0, textNode.characters.length, { type: 'UNORDERED' })

// Numbered list
textNode.setRangeListOptions(0, textNode.characters.length, { type: 'ORDERED' })

// Remove list
textNode.setRangeListOptions(0, textNode.characters.length, { type: 'NONE' })
```

## Getting Text Segments

```javascript
// Get all styled segments
const segments = textNode.getStyledTextSegments(['fontName', 'fontSize', 'fills', 'textDecoration'])

for (const segment of segments) {
  console.log(`"${segment.characters}" - ${segment.fontName.family} ${segment.fontSize}px`)
}
```

## Inserting and Deleting Characters

```javascript
// Load all fonts (handles mixed fonts via styled segments)
const segments = textNode.getStyledTextSegments(['fontName'])
await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))

// Insert text at a position
textNode.insertCharacters(0, 'Hello ') // Insert at start
textNode.insertCharacters(textNode.characters.length, '!') // Insert at end
textNode.insertCharacters(6, 'beautiful ') // Insert in middle

// Delete characters (start, end)
textNode.deleteCharacters(0, 6) // Delete first 6 characters
textNode.deleteCharacters(5, 10) // Delete characters 5-9

figma.closePlugin()
```

## Splitting Text into Multiple Nodes

To split a text node into separate nodes (one per line/paragraph):

```javascript
const nodeId = '123:456'
const node = await figma.getNodeByIdAsync(nodeId)

if (node && node.type === 'TEXT') {
  // Load all fonts (handles mixed fonts via styled segments)
  const segments = node.getStyledTextSegments(['fontName'])
  await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))

  const lines = node.characters.split(/\r?\n/)
  const parent = node.parent
  const index = parent.children.indexOf(node)

  // Calculate line height for positioning
  const lineHeight =
    typeof node.lineHeight === 'object' && node.lineHeight.unit === 'PIXELS'
      ? node.lineHeight.value
      : node.fontSize * 1.2

  const createdNodes = []
  for (const line of lines) {
    if (!line.trim()) continue

    // Clone preserves ALL properties (lineHeight, letterSpacing, etc.)
    const newNode = node.clone()
    newNode.characters = line.trim()

    // Position vertically using lineHeight (for non-auto-layout parents)
    if (parent.layoutMode === 'NONE' || !parent.layoutMode) {
      newNode.y = node.y + createdNodes.length * lineHeight
    }

    parent.insertChild(index + createdNodes.length, newNode)
    createdNodes.push(newNode)
  }

  node.remove()
  console.log(`Split into ${createdNodes.length} nodes`)
}

figma.closePlugin()
```

**Key points:**

1. Use `clone()` to preserve all text properties (lineHeight, letterSpacing, textCase, etc.)
2. Position using `lineHeight` directly - use PIXELS value if set, otherwise `fontSize * 1.2`
3. For verification exports, export the parent frame - don't use temporary grouping

## Find and Replace Across Page

To search and replace text content across many nodes:

```javascript
;(async () => {
  const searchText = 'Sign Up'
  const replaceText = 'Register'
  const caseSensitive = false

  const textNodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })
  console.log(`Searching ${textNodes.length} text nodes for "${searchText}"...`)

  const regex = new RegExp(
    searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    caseSensitive ? 'g' : 'gi',
  )

  let totalReplacements = 0
  let nodesModified = 0

  for (const node of textNodes) {
    if (!regex.test(node.characters)) continue
    regex.lastIndex = 0

    // Load all fonts used in this node (handles mixed fonts via styled segments)
    const segments = node.getStyledTextSegments(['fontName'])
    await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))

    const matches = node.characters.match(regex)?.length || 0
    console.log(`  ${node.name}: "${node.characters}" → ${matches} match(es)`)

    node.characters = node.characters.replace(regex, replaceText)
    totalReplacements += matches
    nodesModified++
  }

  console.log(`Replaced ${totalReplacements} occurrence(s) across ${nodesModified} node(s)`)
  figma.closePlugin()
})()
```

### Scoped Find and Replace (Within a Frame)

```javascript
const frame = await figma.getNodeByIdAsync('123:456')
if (frame && 'findAllWithCriteria' in frame) {
  const textNodes = frame.findAllWithCriteria({ types: ['TEXT'] })
  // ... same replacement logic as above
}
```
### Preserving Styled Ranges
When text has mixed styling (bold + regular), replacing `characters` wholesale resets all styling to the first character's style. To preserve ranges, use `deleteCharacters` + `insertCharacters`:
```javascript
async function replacePreservingStyles(node, search, replace) {
  if (!node || !('characters' in node)) {
    throw new TypeError('replacePreservingStyles requires a text-capable node')
  }
  // Load all fonts (handles mixed fonts via styled segments)
  const segments = node.getStyledTextSegments(['fontName'])
  await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))

  let idx = node.characters.indexOf(search)
  while (idx !== -1) {
    node.deleteCharacters(idx, idx + search.length)
    node.insertCharacters(idx, replace)
    idx = node.characters.indexOf(search, idx + replace.length)
  }
}
```

## OpenType Features

```javascript
// Get current features for a range
const features = textNode.getRangeOpenTypeFeatures(0, 1)

// Inspect node-level OpenType features
const nodeFeatures = textNode.openTypeFeatures
if (nodeFeatures !== figma.mixed) {
  console.log('LIGA:', nodeFeatures.LIGA, 'CALT:', nodeFeatures.CALT)
}
```
