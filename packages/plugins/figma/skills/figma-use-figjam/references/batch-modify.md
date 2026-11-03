# Batch Operations Pattern

> Part of the [figma-use-figjam skill](../SKILL.md). Patterns for modifying many existing nodes at once.

**Typical workflow:**

1. Find nodes using traversal APIs (`findAll`, `findAllWithCriteria`)
2. Apply modifications using the patterns below

## Performance Tips

### 1. Use findAllWithCriteria for Type-Based Searches

`findAllWithCriteria` is significantly faster than `findAll` when filtering by node type only.

```javascript
// ✅ FAST - Use findAllWithCriteria for type filtering
const textNodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })
const shapes = figma.currentPage.findAllWithCriteria({
  types: ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR'],
})

// ❌ SLOWER - findAll with type check
const textNodesSlow = figma.currentPage.findAll((n) => n.type === 'TEXT')

figma.closePlugin()
```

### 2. Limit Search Scope

Search within a specific node rather than the entire page.

```javascript
// ✅ FAST - Search within specific frame, using indexed type lookup
const frame = await figma.getNodeByIdAsync('123:456')
if (frame && 'findAllWithCriteria' in frame) {
  const textInFrame = frame.findAllWithCriteria({ types: ['TEXT'] })
}

// ❌ SLOWER - Whole-page predicate scan
const allText = figma.currentPage.findAll((n) => n.type === 'TEXT')

figma.closePlugin()
```

## Batch Modify Pattern

### Basic Batch Modification

```javascript
const page = figma.currentPage

// Find all buttons
const buttons = page.findAll((n) => n.name.toLowerCase().includes('button'))
console.log(`Found ${buttons.length} buttons`)

// Modify each one
let modified = 0
for (const btn of buttons) {
  if ('fills' in btn) {
    btn.fills = [{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1 } }]
    modified++
  }
}

console.log(`Modified ${modified} buttons`)
figma.closePlugin()
```

### With Progress Logging

For long operations, log progress so you can track what's happening.

```javascript
const nodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })
console.log(`Processing ${nodes.length} text nodes...`)

let processed = 0
for (const node of nodes) {
  // Load all fonts (handles mixed fonts via styled segments)
  const segments = node.getStyledTextSegments(['fontName'])
  await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))
  node.fontSize = 16

  processed++
  if (processed % 50 === 0) {
    console.log(`Processed ${processed}/${nodes.length}`)
  }
}

console.log(`Done! Processed ${processed} nodes`)
figma.closePlugin()
```

## Chunked Processing

For very large operations, process in chunks to avoid timeouts.

```javascript
async function processInChunks(nodes, chunkSize, processFn) {
  const results = []

  for (let i = 0; i < nodes.length; i += chunkSize) {
    const chunk = nodes.slice(i, i + chunkSize)
    console.log(
      `Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(nodes.length / chunkSize)}`,
    )

    for (const node of chunk) {
      const result = await processFn(node)
      results.push(result)
    }
  }

  return results
}

// Usage
const allText = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })

await processInChunks(allText, 100, async (node) => {
  // Load all fonts (handles mixed fonts via styled segments)
  const segments = node.getStyledTextSegments(['fontName'])
  await Promise.all(segments.map((s) => figma.loadFontAsync(s.fontName)))
  node.textCase = 'UPPER'
  return node.id
})

figma.closePlugin()
```

## Collecting Results

### Build Summary Object

```javascript
const textNodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })

// Collect statistics
const fontUsage = {}
for (const node of textNodes) {
  if (node.fontName && node.fontName.family) {
    const key = `${node.fontName.family} ${node.fontName.style}`
    fontUsage[key] = (fontUsage[key] || 0) + 1
  }
}

console.log('Font usage:')
for (const [font, count] of Object.entries(fontUsage).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${font}: ${count}`)
}

figma.closePlugin()
```

### Group by Property

```javascript
const nodes = figma.currentPage.findAll((n) => 'fills' in n)

// Group by fill color
const byColor = {}
for (const node of nodes) {
  if (Array.isArray(node.fills) && node.fills.length > 0) {
    const fill = node.fills[0]
    if (fill.type === 'SOLID') {
      const key = `rgb(${Math.round(fill.color.r * 255)}, ${Math.round(fill.color.g * 255)}, ${Math.round(fill.color.b * 255)})`
      if (!byColor[key]) byColor[key] = []
      byColor[key].push(node.name)
    }
  }
}

console.log('Nodes by color:', JSON.stringify(byColor, null, 2))
figma.closePlugin()
```

## Safe Batch Updates

### Check Before Modify

```javascript
const nodes = figma.currentPage.findAll((n) => n.name.includes('Button'))

for (const node of nodes) {
  // Log before state
  console.log(`${node.name} before:`, 'fills' in node ? JSON.stringify(node.fills) : 'no fills')

  // Check if modification is possible
  if (!('fills' in node)) {
    console.log(`  Skipping ${node.name} - no fills property`)
    continue
  }

  // Modify
  node.fills = [{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1 } }]

  // Log after state
  console.log(`${node.name} after:`, JSON.stringify(node.fills))
}

figma.closePlugin()
```

## Common Patterns: Renaming Layers

### Bulk Find-and-Replace in Names

```javascript
const nodes = figma.currentPage.findAll((n) => n.name.includes('Button'))
console.log(`Found ${nodes.length} nodes to rename`)

for (const node of nodes) {
  const oldName = node.name
  node.name = node.name.replace('Button', 'Btn')
  console.log(`  "${oldName}" → "${node.name}"`)
}

figma.closePlugin()
```

### Auto-Numbering Children

```javascript
const frame = await figma.getNodeByIdAsync('123:456')

if ('children' in frame) {
  for (let i = 0; i < frame.children.length; i++) {
    frame.children[i].name = `Item ${i + 1}`
  }
  console.log(`Numbered ${frame.children.length} children`)
}

figma.closePlugin()
```

### Content-Based Naming (Name from Text Content)

```javascript
const frames = figma.currentPage.findAllWithCriteria({ types: ['FRAME'] })

let renamed = 0
for (const frame of frames) {
  // Use the type-indexed criteria for type-based searches; take the first match.
  const heading = frame.findAllWithCriteria({ types: ['TEXT'] })[0]
  if (heading) {
    frame.name = heading.characters.slice(0, 40)
    renamed++
  }
}

console.log(`Renamed ${renamed} frames from heading text`)
figma.closePlugin()
```

### Strip Auto-Generated Names

```javascript
const autoNamePattern = /^(Frame|Rectangle|Ellipse|Group|Vector|Line|Polygon|Star)\s+\d+$/
const nodes = figma.currentPage.findAll((n) => autoNamePattern.test(n.name))
console.log(`Found ${nodes.length} auto-named nodes`)

for (const node of nodes) {
  node.name = node.type.toLowerCase()
}

figma.closePlugin()
```

### Add Prefix with `/` Separator (Layer Panel Grouping)

Figma groups layers in the panel by `/` in names (e.g., `icons/arrow`, `icons/check`).

```javascript
// Use the type-indexed criteria for the type filter, then narrow by name.
const icons = figma.currentPage
  .findAllWithCriteria({ types: ['INSTANCE'] })
  .filter((n) => n.name.toLowerCase().includes('icon'))

for (const icon of icons) {
  if (!icon.name.startsWith('icons/')) {
    icon.name = `icons/${icon.name}`
  }
}

console.log(`Prefixed ${icons.length} icon layers`)
figma.closePlugin()
```
