# Create Sections

> Part of the [figma-use-figjam skill](../SKILL.md). Creating, modifying, and organizing sections.

**Scope:** Sections are FigJam containers created with `figma.createSection()`. They organize related objects on the board. For creating stickies to place inside sections, see [create-sticky](create-sticky.md). For creating text to place inside sections, see [create-text](create-text.md).

## Creating a Section

Create sections and resize them carefully according to the layout guidance in [plan-board-content](plan-board-content.md).

```javascript
const section = figma.createSection()
section.name = 'My Section'

// Sections start very small — resize to a usable size
section.resize(400, 300)

console.log('Created section:', section.id, section.name, section.width, 'x', section.height)
figma.closePlugin()
```

## Stickies vs. Text Nodes as section content

Stickies and text play different roles. Before adding section child content, make sure to read and understand the usage guidance for each in [create-sticky](create-sticky.md) and [create-text](create-text.md) skills.

## Naming

Section names should be **short, navigational identifiers** (e.g. "Brainstorm", "Action Items", "Went Well") — they are used for browsing and quick identification in FigJam's UI. The section name is NOT the user-facing header. Create a separate **H2 text node** inside the section for the visible, descriptive header. See [plan-board-content](plan-board-content.md) for guidance on clearing section names when the section already has an internal title text node.

```javascript
const section = figma.createSection()
section.name = 'What went well' // Short navigational name

console.log('Section name:', section.name)
figma.closePlugin()
```

To rename an existing section:

```javascript
const section = await figma.getNodeByIdAsync('123:456')
if (section && section.type === 'SECTION') {
  console.log('Before:', section.name)
  section.name = 'Updated name'
  console.log('After:', section.name)
}
figma.closePlugin()
```

## Resizing

Sections support both `resize(width, height)` and `resizeWithoutConstraints(width, height)`. **Prefer `resize(...)`** — it matches the ergonomics of every other resizable node. Sections don't propagate constraints to their children, so the two methods behave identically on sections. Both width and height must be >= 0.01.

```javascript
const section = figma.createSection()
section.name = 'Wide section'
section.resize(800, 400)

console.log('Size:', section.width, 'x', section.height)
figma.closePlugin()
```

### Resizing an Existing Section

Often when creating a section and adding content, the content will exceed the bounds of the section. To solve that, find the maximum extents of the section's children using their section-local coordinates, then resize the section to fit. Consider adding padding of at least 32px on all sides of the content within the section to prevent the content from appearing cramped.

Do not resize the section to hug its contents if it is meant to be a **participatory zone** (workshop, brainstorm, retro lane, feedback area — see [plan-board-content](plan-board-content.md) for the participatory-zone pattern); those should be sized to expected activity, not pre-filled content. Also do not resize sections to hug content when they are part of a **grid layout** — sections in a grid must maintain uniform dimensions to preserve the rectangular appearance.

```javascript
const section = await figma.getNodeByIdAsync('123:456')
if (section && section.type === 'SECTION') {
  if (section.children.length < 1) {
    // for empty sections, choose a reasonable width and height based on the purpose
    section.resize(800, 400)
    figma.closePlugin()
    return
  }
  console.log('Before:', section.width, 'x', section.height)

  // Children's x/y are in section-local coordinates, so find the max extents from (0,0)
  let maxRight = 0
  let maxBottom = 0
  for (const child of section.children) {
    maxRight = Math.max(maxRight, child.x + child.width)
    maxBottom = Math.max(maxBottom, child.y + child.height)
  }

  const padding = 32
  section.resize(maxRight + padding, maxBottom + padding)
  console.log('After:', section.width, 'x', section.height)
}
figma.closePlugin()
```

## Color Palette

FigJam sections use a fixed palette of light tints. Set via the `fills` property. For the canonical palette across all FigJam node types, see [figjam-colors](figjam-colors.md).

When creating multiple sections, **vary the colors** across the palette to visually distinguish them — don't use the same color for every section. Only apply default color variety when the user hasn't specified colors.

**CRITICAL**: Use `hex/255` notation (e.g. `0xF5/255`) for exact palette matching — rounded decimals cause FigJam to treat the color as "custom" instead of a palette color.

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

### Setting a Section's Color

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const section = figma.createSection()
section.name = 'Blue section'
section.resize(400, 300)
section.fills = [{ type: 'SOLID', color: h(0xf5, 0xfb, 0xff) }] // Light blue #F5FBFF

figma.closePlugin()
```

### Changing the Color of an Existing Section

```javascript
const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 })

const section = await figma.getNodeByIdAsync('123:456')
if (section && section.type === 'SECTION') {
  console.log('Before:', JSON.stringify(section.fills))
  section.fills = [{ type: 'SOLID', color: h(0xeb, 0xff, 0xee) }] // Light green #EBFFEE
  console.log('After:', JSON.stringify(section.fills))
}
figma.closePlugin()
```

## Hiding Section Contents

Toggle whether a section's child nodes are visible:

```javascript
const section = await figma.getNodeByIdAsync('123:456')
if (section && section.type === 'SECTION') {
  console.log('Contents hidden before:', section.sectionContentsHidden)
  section.sectionContentsHidden = true
  console.log('Contents hidden after:', section.sectionContentsHidden)
}
figma.closePlugin()
```

## Adding Nodes to a Section

**CRITICAL**: It's very important that you follow the instructions in [position-figjam-nodes](position-figjam-nodes.md): Adding Nodes to a Section. This is _crucial_ for a high-quality output.

## Cloning Sections

```javascript
const original = await figma.getNodeByIdAsync('123:456')
if (original && original.type === 'SECTION') {
  const clone = original.clone()
  clone.x = original.x + original.width + 32
  clone.name = original.name + ' (copy)'
  console.log('Cloned section:', clone.id, clone.name)
}
figma.closePlugin()
```

## Key Points

- **Always wrap code in an async IIFE:** `(async () => { ... })();`
- **Always call `figma.closePlugin()`** at the end of every code path.
- **Use `section.resize(width, height)`** to set section size — `width`/`height` are read-only. Sections also accept `resizeWithoutConstraints(...)`, but `resize(...)` is the preferred method.
- **Resize sections to fit their children.** After adding children to a section, make sure that the section encompasses the children. If you need to resize it, refer to the example of resizing an existing section.
- **Use node IDs** from the user message, not `figma.currentPage.selection`.
- **Verify changes** by logging before/after values and exporting images when supported.
