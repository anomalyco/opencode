# Create Tables

> Part of the [figma-use-figjam skill](../SKILL.md). Creating and styling tables with rows, columns, and cell content.

**Scope:** Tables are FigJam-specific nodes created with `figma.createTable()`. They structure content in rows and columns. For stickies and sections, see [create-sticky](create-sticky.md) and [create-section](create-section.md). For shapes with text in them, see [create-shape-with-text](create-shape-with-text.md).

**When to use this skill:** Prefer FigJam tables whenever the user asks for a table, spreadsheet, comparison grid, roster, or any row/column layout of text data. Examples: "create a table", "add a spreadsheet", "make a grid with names and roles", "comparison table", "team roster", "data table". Do **not** build a table-like layout out of shapes with text or other node types.

**When NOT to use this skill:** Prefer creating other node types or relying on node positioning on the canvas in order to organize non-text content.

**Note:** The Table API is only available in FigJam.

## Creating a Table

Default to applying a dark color to the header row(s) but leave the other cells to have the default fill (without making any edits), unless the user provides guiddance on styling.

**CRITICAL**: If the user provides real data to include (e.g. in the form of CSV, image, etc.), include **all** of it in the resulting table. Never intermix real data with placeholder data. Otherwise if no data is provied, create tables without any placeholder content in headers, rows, columns, or cells.

**CRITICAL**: Never delete any source data from the canvas when asked to convert to a table.

```javascript
// Default: 2 rows, 2 columns, parented under figma.currentPage
const table = figma.createTable()

// Or specify dimensions: createTable(numRows?, numColumns?)
const table3x4 = figma.createTable(3, 4)

console.log('Created table:', table.id, table.numRows, 'x', table.numColumns)
figma.closePlugin()
```

## Setting Cell Text

Each cell is a `TableCellNode` with a `text` sublayer (`TextSublayerNode`). You must load the font before setting `characters`. Use `table.cellAt(rowIndex, columnIndex)` to get a cell (indices are zero-based).

```javascript
const table = figma.createTable(2, 3)

// Load the font before setting characters
await figma.loadFontAsync(table.cellAt(0, 0).text.fontName)

// Set characters for each cell (example: header row A B C, data row 1 2 3)
table.cellAt(0, 0).text.characters = 'A'
table.cellAt(0, 1).text.characters = 'B'
table.cellAt(0, 2).text.characters = 'C'
table.cellAt(1, 0).text.characters = '1'
table.cellAt(1, 1).text.characters = '2'
table.cellAt(1, 2).text.characters = '3'

table.x = 0
table.y = 0

figma.closePlugin()
```

### Modifying Text in an Existing Table

```javascript
const table = await figma.getNodeByIdAsync('123:456')
if (table && table.type === 'TABLE') {
  const cell = table.cellAt(0, 0)
  await figma.loadFontAsync(cell.text.fontName)
  cell.text.characters = 'Updated'
}
figma.closePlugin()
```

## TableNode Properties

- **type**: `'TABLE'` (readonly)
- **numRows**, **numColumns**: number (readonly) — number of rows and columns
- **cellAt(rowIndex, columnIndex)**: returns the `TableCellNode` at that position
- **width**, **height**: number (readonly) — use `resizeRow` / `resizeColumn` to change size

### Adding and Removing Rows/Columns

```javascript
const table = figma.createTable(2, 2)

// Insert a row before index 1 (so new row is at index 1)
table.insertRow(1)

// Insert a column before index 0
table.insertColumn(0)

// Remove row at index 2, column at index 0
table.removeRow(2)
table.removeColumn(0)

figma.closePlugin()
```

### Moving Rows and Columns

```javascript
const table = await figma.getNodeByIdAsync('123:456')
if (table && table.type === 'TABLE') {
  // moveRow(fromIndex, toIndex) — move row from fromIndex to toIndex
  table.moveRow(2, 0)

  // moveColumn(fromIndex, toIndex)
  table.moveColumn(1, 0)
}
figma.closePlugin()
```

### Resizing Rows and Columns

Rows and columns cannot be resized smaller than their minimum size. Use `resizeRow(rowIndex, height)` and `resizeColumn(columnIndex, width)`.

```javascript
const table = figma.createTable(3, 3)

// Resize first row to 60px height, first column to 120px width
table.resizeRow(0, 60)
table.resizeColumn(0, 120)

console.log('Table size:', table.width, 'x', table.height)
figma.closePlugin()
```

## TableCellNode Properties

- **type**: `'TABLE_CELL'` (readonly)
- **text**: TextSublayerNode (readonly) — the cell’s text; load font then set `text.characters`
- **rowIndex**, **columnIndex**: number (readonly) — cell position in the table
- **width**, **height**: number (readonly) — determined by table layout
- **fills**: set cell background (e.g. header row styling)

### Setting Cell Fills

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const table = figma.createTable(2, 3)
await figma.loadFontAsync(table.cellAt(0, 0).text.fontName)

// Header row: light blue background
for (let c = 0; c < 3; c++) {
  const cell = table.cellAt(0, c)
  cell.fills = [{ type: 'SOLID', color: h(0xc2, 0xe5, 0xff) }] // Light blue #C2E5FF
  cell.text.characters = ['A', 'B', 'C'][c]
}
// Data row
table.cellAt(1, 0).text.characters = '1'
table.cellAt(1, 1).text.characters = '2'
table.cellAt(1, 2).text.characters = '3'

figma.closePlugin()
```

## Table-Level Fills

The table itself has a `fills` property for the overall table background. Use `setFillsAsync` for pattern fills; for solid fills you can set `table.fills` directly.

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const table = figma.createTable(2, 2)
table.fills = [{ type: 'SOLID', color: h(0xff, 0xec, 0xbd) }] // Light yellow #FFECBD

figma.closePlugin()
```

## Color Options

FigJam tables use the same color palette as sections and shapes. You can style:

- **Table fill** — `table.fills` (overall table background)
- **Cell fill** — `table.cellAt(row, col).fills` (per-cell background, e.g. header row)
- **Cell text color** — `cell.text.fills` (set after loading fonts)

Tables do **not** have strokes. When applying colors, set **fill and text together** so contrast is correct: dark fills use white text; light fills use dark text. Strongly prefer colors from this list so the table matches the FigJam editor palette.

### Color Preset Map

Use this map for table fills and cell fills. For **cell text**, use the `text` value (white on dark fills, dark on light fills). **CRITICAL**: Use `hex/255` notation (e.g. `0x66/255`) for exact palette matching — rounded decimals cause FigJam to treat the color as "custom" instead of a palette color.

If the user asks for a color by a similar but different name, identify the closest option available from this map, keeping in mind the cell context (e.g. header row, body cell, etc). For example, choose `violet` if asked for a purple header or `lightGreen` if asked for green rows.

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const WHITE = h(0xff, 0xff, 0xff)
const DARK = h(0x1e, 0x1e, 0x1e)

const TABLE_COLOR_PRESETS = {
  // Dark fills (e.g. header row) — use white text
  black: { fill: h(0x1e, 0x1e, 0x1e), text: WHITE },
  darkGray: { fill: h(0x75, 0x75, 0x75), text: WHITE },
  green: { fill: h(0x66, 0xd5, 0x75), text: WHITE },
  teal: { fill: h(0x5a, 0xd8, 0xcc), text: WHITE },
  blue: { fill: h(0x3d, 0xad, 0xff), text: WHITE },
  violet: { fill: h(0x87, 0x4f, 0xff), text: WHITE },
  pink: { fill: h(0xf8, 0x49, 0xc1), text: WHITE },
  red: { fill: h(0xf2, 0x48, 0x22), text: WHITE },
  orange: { fill: h(0xff, 0x9e, 0x42), text: WHITE },

  // Light fills (e.g. table background, body cells) — use dark text
  gray: { fill: h(0xb3, 0xb3, 0xb3), text: DARK },
  lightGray: { fill: h(0xd9, 0xd9, 0xd9), text: DARK },
  lightGreen: { fill: h(0xcd, 0xf4, 0xd3), text: DARK },
  lightTeal: { fill: h(0xc6, 0xfa, 0xf6), text: DARK },
  lightBlue: { fill: h(0xc2, 0xe5, 0xff), text: DARK },
  lightViolet: { fill: h(0xdc, 0xcc, 0xff), text: DARK },
  lightPink: { fill: h(0xff, 0xc2, 0xec), text: DARK },
  lightRed: { fill: h(0xff, 0xc7, 0xc2), text: DARK },
  lightOrange: { fill: h(0xff, 0xe0, 0xc2), text: DARK },
  yellow: { fill: h(0xff, 0xc9, 0x43), text: DARK },
  lightYellow: { fill: h(0xff, 0xec, 0xbd), text: DARK },
  white: { fill: h(0xff, 0xff, 0xff), text: DARK },
}
```

### Hex Reference

| Color        | Fill Hex  | Text  |
| ------------ | --------- | ----- |
| Black        | `#1E1E1E` | white |
| Dark gray    | `#757575` | white |
| Gray         | `#B3B3B3` | dark  |
| Light gray   | `#D9D9D9` | dark  |
| Green        | `#66D575` | white |
| Light green  | `#CDF4D3` | dark  |
| Teal         | `#5AD8CC` | white |
| Light teal   | `#C6FAF6` | dark  |
| Blue         | `#3DADFF` | white |
| Light blue   | `#C2E5FF` | dark  |
| Violet       | `#874FFF` | white |
| Light violet | `#DCCCFF` | dark  |
| Pink         | `#F849C1` | white |
| Light pink   | `#FFC2EC` | dark  |
| Red          | `#F24822` | white |
| Light red    | `#FFC7C2` | dark  |
| Orange       | `#FF9E42` | white |
| Light orange | `#FFE0C2` | dark  |
| Yellow       | `#FFC943` | dark  |
| Light yellow | `#FFECBD` | dark  |
| White        | `#FFFFFF` | dark  |

_white = `#FFFFFF`, dark = `#1E1E1E`_

### Applying Table and Cell Colors

Set table background, then cell fills and text colors. Load the cell font before setting `text.fills` or `text.characters`:

**CRITICAL**: Never clear or remove the fill from a table or cell node. Instead, interpret this as an ask to reset to the default fill color (i.e. white).

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })
const DARK = h(0x1e, 0x1e, 0x1e)
const preset = {
  fill: h(0xc2, 0xe5, 0xff), // Light blue
  text: DARK,
}

const table = figma.createTable(2, 3)
await figma.loadFontAsync(table.cellAt(0, 0).text.fontName)

// Table-level background
table.fills = [{ type: 'SOLID', color: preset.fill }]

// Header row: dark fill, white text
const headerPreset = { fill: h(0x3d, 0xad, 0xff), text: h(0xff, 0xff, 0xff) }
for (let c = 0; c < 3; c++) {
  const cell = table.cellAt(0, c)
  cell.fills = [{ type: 'SOLID', color: headerPreset.fill }]
  cell.text.fills = [{ type: 'SOLID', color: headerPreset.text }]
  cell.text.characters = ['Name', 'Role', 'Team'][c]
}

// Body row: light fill (or inherit table fill), dark text
for (let c = 0; c < 3; c++) {
  const cell = table.cellAt(1, c)
  cell.text.fills = [{ type: 'SOLID', color: preset.text }]
  cell.text.characters = ['Alice', 'Designer', 'Product'][c]
}

figma.closePlugin()
```

### Changing Color on an Existing Table

```javascript
const table = await figma.getNodeByIdAsync('123:456')
if (table && table.type === 'TABLE') {
  await figma.loadFontAsync(table.cellAt(0, 0).text.fontName)
  const preset = TABLE_COLOR_PRESETS.lightGreen
  table.fills = [{ type: 'SOLID', color: preset.fill }]
  // Optionally update header or specific cells
  table.cellAt(0, 0).fills = [{ type: 'SOLID', color: preset.fill }]
  table.cellAt(0, 0).text.fills = [{ type: 'SOLID', color: preset.text }]
}
figma.closePlugin()
```

## Building a Table from Data

```javascript
const rows = [
  ['Name', 'Role', 'Team'],
  ['Alice', 'Designer', 'Product'],
  ['Bob', 'Engineer', 'Platform'],
]
const numRows = rows.length
const numCols = rows[0].length

const table = figma.createTable(numRows, numCols)
await figma.loadFontAsync(table.cellAt(0, 0).text.fontName)

for (let r = 0; r < numRows; r++) {
  for (let c = 0; c < numCols; c++) {
    table.cellAt(r, c).text.characters = rows[r][c]
  }
}

table.name = 'Team roster'

figma.closePlugin()
```

## Cloning Tables

```javascript
const original = await figma.getNodeByIdAsync('123:456')
if (original && original.type === 'TABLE') {
  const clone = original.clone()
  clone.x = original.x + original.width + 20
  console.log('Cloned table:', clone.id, clone.numRows, 'x', clone.numColumns)
}
figma.closePlugin()
```

## Key Points

- **Always wrap code in an async IIFE:** `(async () => { ... })();`
- **Always call `figma.closePlugin()`** at the end of every code path.
- **Initial table content:** Prefer empty tables unless the user provides data; then include all of it (no placeholders) and do not delete source data when converting. Use a dark header row and default fill elsewhere.
- **Follow the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids)** for `cell.text.characters` and `cell.text.fills` — load `cell.text.fontName` (use the first cell’s, or each cell’s if they differ).
- **Set fill and text color together** when styling cells — use the color presets so light fills get dark text and dark fills get white text.
- **Use `hex/255` notation** for palette colors (e.g. `h(0xC2, 0xE5, 0xFF)`) so FigJam treats them as palette colors, not custom.
- **Table API is FigJam-only** — `figma.createTable()` is not available in Figma Design or other editor types.
- **Indices are zero-based**: `cellAt(0, 0)` is the top-left cell.
- **Table dimensions**: `width` and `height` are readonly; use `resizeRow` and `resizeColumn` to change size. Rows/columns cannot be resized below their minimum.
- **Use node IDs** from the user message, not `figma.currentPage.selection`.
- **Verify changes** by logging before/after values when helpful.
