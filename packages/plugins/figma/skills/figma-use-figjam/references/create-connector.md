# Create Connectors

> Part of the [figma-use-figjam skill](../SKILL.md). Creating connectors between nodes — endpoints, arrows, line types, labels, and colors.

**Scope:** Connectors are FigJam-specific nodes created with `figma.createConnector()`. They connect shapes, stickies, sections, and other nodes to show relationships. For creating shapes to connect, see [create-shape-with-text](create-shape-with-text.md). For stickies, see [create-sticky](create-sticky.md). For sections, see [create-section](create-section.md).

## Creating a Connector Between Two Nodes

```javascript
const connector = figma.createConnector()
connector.connectorStart = { endpointNodeId: '123:456', magnet: 'AUTO' }
connector.connectorEnd = { endpointNodeId: '123:789', magnet: 'AUTO' }

console.log('Created connector:', connector.id)
figma.closePlugin()
```

## Connector Endpoints

Endpoints define where the connector starts and ends. There are three forms:

### Attached to a node with auto-magnet (most common)

```javascript
connector.connectorStart = { endpointNodeId: nodeA.id, magnet: 'AUTO' }
connector.connectorEnd = { endpointNodeId: nodeB.id, magnet: 'AUTO' }
```

### Attached to a node at a specific side

Magnet values: `'AUTO'`, `'TOP'`, `'BOTTOM'`, `'LEFT'`, `'RIGHT'`, `'CENTER'`, `'NONE'`

```javascript
connector.connectorStart = { endpointNodeId: nodeA.id, magnet: 'RIGHT' }
connector.connectorEnd = { endpointNodeId: nodeB.id, magnet: 'LEFT' }
```

### Floating (not attached to any node)

```javascript
connector.connectorStart = { position: { x: 100, y: 200 } }
connector.connectorEnd = { position: { x: 400, y: 200 } }
```

### Attached to a node at a specific position (relative, 0–1)

```javascript
connector.connectorStart = { endpointNodeId: nodeA.id, position: { x: 1, y: 0.5 } }
connector.connectorEnd = { endpointNodeId: nodeB.id, position: { x: 0, y: 0.5 } }
```

## Line Types

```javascript
connector.connectorLineType = 'ELBOWED' // Right-angle bends (default)
connector.connectorLineType = 'STRAIGHT' // Direct line
connector.connectorLineType = 'CURVED' // Smooth curve
```

## Stroke Caps (Arrows)

Control the arrowheads at each end of the connector.

Available cap styles: `'NONE'`, `'ARROW_LINES'`, `'ARROW_EQUILATERAL'`, `'TRIANGLE_FILLED'`, `'DIAMOND_FILLED'`, `'CIRCLE_FILLED'`

```javascript
const connector = figma.createConnector()
connector.connectorStart = { endpointNodeId: nodeA.id, magnet: 'AUTO' }
connector.connectorEnd = { endpointNodeId: nodeB.id, magnet: 'AUTO' }

// Arrow at the end only (most common for directed flows)
connector.connectorStartStrokeCap = 'NONE'
connector.connectorEndStrokeCap = 'ARROW_LINES'

figma.closePlugin()
```

### Common arrow configurations

```javascript
// One-way arrow (A → B)
connector.connectorStartStrokeCap = 'NONE'
connector.connectorEndStrokeCap = 'ARROW_LINES'

// Two-way arrow (A ↔ B)
connector.connectorStartStrokeCap = 'ARROW_LINES'
connector.connectorEndStrokeCap = 'ARROW_LINES'

// No arrows (plain line)
connector.connectorStartStrokeCap = 'NONE'
connector.connectorEndStrokeCap = 'NONE'

// Filled triangle arrow
connector.connectorEndStrokeCap = 'ARROW_EQUILATERAL'

// Diamond endpoint
connector.connectorStartStrokeCap = 'DIAMOND_FILLED'

// Circle endpoint
connector.connectorStartStrokeCap = 'CIRCLE_FILLED'
```

## Adding a Text Label

Connectors have a `text` sublayer for visible labels. You must load fonts before setting text.

**CRITICAL**: To display text on a connector, set `connector.text.characters` — NOT `connector.name`. Setting `connector.name` only changes the layer name in the layers panel and is NOT visible on the canvas.

**CRITICAL**: A newly created connector's `text.fontName` is **invalid by default** — calling `figma.loadFontAsync(connector.text.fontName)` will fail. You must explicitly set `connector.text.fontName` to a known font (after loading it), then set `connector.text.characters`.

```javascript
const font = { family: 'Inter', style: 'Medium' }
await figma.loadFontAsync(font)

const connector = figma.createConnector()
connector.connectorStart = { endpointNodeId: nodeA.id, magnet: 'AUTO' }
connector.connectorEnd = { endpointNodeId: nodeB.id, magnet: 'AUTO' }

// Explicitly set the font, then set text
connector.text.fontName = font
connector.text.characters = 'depends on' // This is the visible label

figma.closePlugin()
```

### Modifying label on an existing connector

For existing connectors that already have text, `text.fontName` is valid and can be loaded directly:

```javascript
const connector = await figma.getNodeByIdAsync('123:456')
if (connector && connector.type === 'CONNECTOR') {
  await figma.loadFontAsync(connector.text.fontName)
  connector.text.characters = 'new label'
}
figma.closePlugin()
```

## Color Presets

Connectors use a 13-color stroke palette — the same hue family used by `createShapeWithText`. The line color is set via `strokes`. The connector's text label has its own background and its color does **not** change when the line color changes — only set the stroke. For the canonical palette across all FigJam node types, see [figjam-colors](figjam-colors.md).

**CRITICAL**: Use `hex/255` notation (e.g. `0x66/255`) for exact palette matching — rounded decimals cause FigJam to treat the color as "custom".

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

### Setting a Connector's Color

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const connector = figma.createConnector()
connector.connectorStart = { endpointNodeId: nodeA.id, magnet: 'AUTO' }
connector.connectorEnd = { endpointNodeId: nodeB.id, magnet: 'AUTO' }
connector.strokes = [{ type: 'SOLID', color: h(0x3d, 0xad, 0xff) }] // Blue #3DADFF

figma.closePlugin()
```

### Changing color on an existing connector

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const connector = await figma.getNodeByIdAsync('123:456')
if (connector && connector.type === 'CONNECTOR') {
  connector.strokes = [{ type: 'SOLID', color: h(0xff, 0x75, 0x56) }] // Red #FF7556
}
figma.closePlugin()
```

## Stroke Weight and Dash Pattern

```javascript
const connector = figma.createConnector()
connector.connectorStart = { endpointNodeId: nodeA.id, magnet: 'AUTO' }
connector.connectorEnd = { endpointNodeId: nodeB.id, magnet: 'AUTO' }

connector.strokeWeight = 2

// Dashed line
connector.dashPattern = [10, 5]

// Dotted line
connector.dashPattern = [2, 4]

// Solid line (default)
connector.dashPattern = []

figma.closePlugin()
```

## Finding Connectors Attached to a Node

Every node with connectors has an `attachedConnectors` property:

```javascript
const node = await figma.getNodeByIdAsync('123:456')
if (node && 'attachedConnectors' in node) {
  for (const conn of node.attachedConnectors) {
    console.log('Connector:', conn.id, 'type:', conn.connectorLineType)
    console.log('  start:', JSON.stringify(conn.connectorStart))
    console.log('  end:', JSON.stringify(conn.connectorEnd))
    console.log('  label:', conn.text.characters)
  }
}
figma.closePlugin()
```

## Batch Creation: Connecting a Chain of Nodes with Labels

```javascript
const nodeIds = ['1:10', '1:20', '1:30', '1:40']
const labels = ['Step 1→2', 'Step 2→3', 'Step 3→4']
const font = { family: 'Inter', style: 'Regular' }
await figma.loadFontAsync(font)

for (let i = 0; i < nodeIds.length - 1; i++) {
  const connector = figma.createConnector()
  connector.connectorStart = { endpointNodeId: nodeIds[i], magnet: 'AUTO' }
  connector.connectorEnd = { endpointNodeId: nodeIds[i + 1], magnet: 'AUTO' }
  connector.connectorStartStrokeCap = 'NONE'
  connector.connectorEndStrokeCap = 'ARROW_LINES'

  // Set visible label (not connector.name, which is just the layer name)
  connector.text.fontName = font
  connector.text.characters = labels[i]
}

figma.closePlugin()
```

## Batch Creation: Flowchart with Shapes and Connectors

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const preset = {
  fill: h(0xc2, 0xe5, 0xff), // Light blue
  stroke: h(0x3d, 0xad, 0xff), // Blue
  text: h(0x1e, 0x1e, 0x1e), // Dark
}

const steps = ['Start', 'Process', 'Review', 'Done']
const shapeW = 160
const shapeH = 80
const spacing = 80

const totalWidth = steps.length * shapeW + (steps.length - 1) * spacing
const startX = 0

// Every shape uses the same default font — load once before the loop
// rather than awaiting per-iteration.
const probe = figma.createShapeWithText()
await figma.loadFontAsync(probe.text.fontName)
probe.remove()
const nodes = []
for (let i = 0; i < steps.length; i++) {
  const shape = figma.createShapeWithText()
  shape.text.characters = steps[i]
  shape.resize(shapeW, shapeH)
  shape.fills = [{ type: 'SOLID', color: preset.fill }]
  shape.strokes = [{ type: 'SOLID', color: preset.stroke }]
  shape.text.fills = [{ type: 'SOLID', color: preset.text }]
  shape.x = startX + i * (shapeW + spacing)
  nodes.push(shape)
}

for (let i = 0; i < nodes.length - 1; i++) {
  const connector = figma.createConnector()
  connector.connectorStart = { endpointNodeId: nodes[i].id, magnet: 'AUTO' }
  connector.connectorEnd = { endpointNodeId: nodes[i + 1].id, magnet: 'AUTO' }
  connector.connectorStartStrokeCap = 'NONE'
  connector.connectorEndStrokeCap = 'ARROW_LINES'
  connector.strokes = [{ type: 'SOLID', color: preset.stroke }]
}

figma.closePlugin()
```

## Batch Creation: Star/Hub Pattern (One Node to Many)

```javascript
const hubId = '1:100'
const spokeIds = ['1:200', '1:201', '1:202', '1:203']

for (const spokeId of spokeIds) {
  const connector = figma.createConnector()
  connector.connectorStart = { endpointNodeId: hubId, magnet: 'AUTO' }
  connector.connectorEnd = { endpointNodeId: spokeId, magnet: 'AUTO' }
  connector.connectorEndStrokeCap = 'ARROW_LINES'
}

figma.closePlugin()
```

## Cloning Connectors

```javascript
const original = await figma.getNodeByIdAsync('123:456')
if (original && original.type === 'CONNECTOR') {
  const clone = original.clone()
  console.log('Cloned connector:', clone.id)
}
figma.closePlugin()
```

## Key Points

- **Always wrap code in an async IIFE:** `(async () => { ... })();`
- **Always call `figma.closePlugin()`** at the end of every code path.
- **Visible text = `connector.text.characters`**, NOT `connector.name`. `name` is only the layer name in the panel — it does not appear on the canvas.
- **Connector text needs explicit font setup.** A new connector's `text.fontName` is invalid by default — load a known font, set `connector.text.fontName`, then set `connector.text.characters`. For existing connectors with text, `text.fontName` is valid and can be loaded directly.
- **Use `magnet: 'AUTO'`** for most cases — Figma picks the best attachment point.
- **Only set `strokes` for connector color** — the text label color does not change with the line color.
- **Default caps**: start = `'NONE'`, end = `'ARROW_LINES'` — explicitly set both if you want a different configuration.
- **Use node IDs** from the user message, not `figma.currentPage.selection`.
- **Use `attachedConnectors`** to find existing connectors on a node.
- **Verify changes** by logging before/after values and exporting images when supported.
