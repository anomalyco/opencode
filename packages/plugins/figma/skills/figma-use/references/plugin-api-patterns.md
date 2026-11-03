# Plugin API Patterns

> Part of the [use_figma skill](../SKILL.md). Quick reference for common Figma Plugin API operations.

## Contents

- Execution Basics
- Creating Nodes (Frames, Text, Rectangles, Ellipses, Lines, Vectors, SVG Import)
- Fills and Strokes (Solid, Linear Gradient, Radial Gradient, Multiple Fills)
- Auto Layout
- Effects
- Opacity and Blend Modes
- Corner Radius and Clipping
- Grouping and Organization
- Components and Variants
- Styles
- Cloning, Finding Nodes, and Grids
- Constraints and Viewport


## Execution Basics

### Page Context

Page context resets between `use_figma` calls — `figma.currentPage` always starts on the first page. Use `await figma.setCurrentPageAsync(page)` at the start of each invocation to switch to the correct page. The sync setter `figma.currentPage = page` does **NOT work** and will throw — always use the async method.

```javascript
const targetPage = figma.root.children.find(p => p.name === "My Page");
await figma.setCurrentPageAsync(targetPage);
// targetPage.children is now populated
```

### Returning Results

Scripts are automatically wrapped in an async IIFE with error handling. Just write plain JS and use `return` to send data back to the agent:

```javascript
// Return an object — auto-serialized to JSON
return { nodeId: frame.id, count: 5 }

// Return a string
return "Created 3 components"
```

Errors are automatically captured — no try/catch needed. `figma.notify()` does **not** exist. Return all information via the `return` value.

### Working Incrementally

Don't build an entire screen in one call. Break work into small steps:
1. Create tokens/variables
2. Create text styles
3. Build individual components
4. Compose sections
5. Assemble screens

Verify structure with `get_metadata` between steps. Use `get_screenshot` after each major creation milestone to catch visual problems early.

## Creating Nodes

### Frames

```javascript
const frame = figma.createFrame();
frame.name = "Container";
frame.resize(1440, 900);
frame.x = 0;
frame.y = 0;
frame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
```

### Text

Canonical recipe: load font → `await` → mutate → return affected IDs. This pattern is the same for every font — `Inter` happens to be preloaded so the missing-`loadFontAsync` bug usually only surfaces with other families. See [gotchas.md → Canonical text-edit recipe](gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids).

```javascript
// Load font BEFORE any text mutation — required for every font, not just Inter
await figma.loadFontAsync({ family: "Inter", style: "Regular" });

const text = figma.createText();
text.fontName = { family: "Inter", style: "Regular" };
text.fontSize = 16;
text.lineHeight = { value: 24, unit: "PIXELS" };
text.letterSpacing = { value: 0, unit: "PERCENT" };
text.characters = "Hello World";
text.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
```

### Rectangles

```javascript
const rect = figma.createRectangle();
rect.name = "Background";
rect.resize(400, 300);
rect.cornerRadius = 12;
rect.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.96 } }];
```

### Ellipses

```javascript
const circle = figma.createEllipse();
circle.name = "Avatar Circle";
circle.resize(48, 48);
circle.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.87, b: 0.90 } }];
```

### Lines

```javascript
const line = figma.createLine();
line.name = "Divider";
line.resize(400, 0);
line.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
line.strokeWeight = 1;
```

### Vectors (Custom Paths)

Use `figma.createVector()` for any shape that can't be built from primitives — organic curves, flowing contours, custom silhouettes. The `vectorPaths` property accepts SVG path data.

```javascript
const vector = figma.createVector();
vector.vectorPaths = [{
  windingRule: "NONZERO",
  data: "M 0 60 C 30 10 70 10 100 50 C 130 90 170 20 200 40 L 200 100 L 0 100 Z"
}];
vector.fills = [{ type: 'SOLID', color: { r: 0.15, g: 0.3, b: 0.55 } }];
vector.strokes = [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.4 } }];
vector.strokeWeight = 2;
```

SVG path commands: `M` (move to), `L` (line to), `C x1 y1 x2 y2 x y` (cubic bezier), `Q x1 y1 x y` (quadratic bezier), `A rx ry rot large sweep x y` (arc), `Z` (close). Uppercase = absolute, lowercase = relative.

Vectors support all the same properties as other shapes — fills, strokes, effects, brushes, dynamic strokes, variable-width strokes, and texture effects.

### SVG Import

```javascript
const svgString = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 12h14M12 5l7 7-7 7" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const node = figma.createNodeFromSvg(svgString);
node.name = "Icon/Arrow Right";
node.resize(24, 24);
```

## Fills & Strokes

### Solid Fill

```javascript
node.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
```

### Fill with Opacity

```javascript
node.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 }, opacity: 0.5 }];
```

### No Fill (Transparent)

```javascript
node.fills = [];
```

### Linear Gradient

```javascript
node.fills = [{
  type: "GRADIENT_LINEAR",
  gradientStops: [
    { color: { r: 0.2, g: 0.36, b: 0.96, a: 1 }, position: 0 },
    { color: { r: 0.56, g: 0.24, b: 0.88, a: 1 }, position: 1 }
  ],
  gradientTransform: [[1, 0, 0], [0, 1, 0]]  // left-to-right (default)
}];

// Top-to-bottom:
// gradientTransform: [[0, 1, 0], [-1, 0, 1]]
```

### Radial Gradient

```javascript
node.fills = [{
  type: "GRADIENT_RADIAL",
  gradientStops: [
    { color: { r: 0.95, g: 0.7, b: 0.3, a: 1 }, position: 0 },   // bright center
    { color: { r: 0.82, g: 0.38, b: 0.14, a: 1 }, position: 1 }   // deeper edge
  ],
  // 2x3 affine matrix [[scaleX, shearX, tx], [shearY, scaleY, ty]]
  // Scale <1 = gradient LARGER than shape (freeform color — use for illustration)
  // Scale >1 = gradient SMALLER than shape (obvious oval — avoid for illustration)
  gradientTransform: [[0.71, 0, 0.19], [0, 0.57, 0.21]]  // large, offset
}];
```

### Strokes

```javascript
node.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.87 } }];
node.strokeWeight = 1;
node.strokeAlign = "INSIDE";  // "CENTER", "OUTSIDE"
```

### Multiple Fills (Layered)

```javascript
node.fills = [
  { type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.96 } },
  { type: "SOLID", color: { r: 0.2, g: 0.36, b: 0.96 }, opacity: 0.05 }
];
```

## Auto Layout

### Setting Up Auto Layout

**Prefer `figma.createAutoLayout()`** — it returns a frame with `layoutMode` already set and both axes hugging content, so children can immediately use `layoutSizingHorizontal/Vertical = "FILL"`.

```javascript
const frame = figma.createAutoLayout(); // HORIZONTAL by default
const column = figma.createAutoLayout("VERTICAL");

// Customize from there as usual:
frame.itemSpacing = 16;
frame.paddingTop = 24;
frame.paddingBottom = 24;
frame.paddingLeft = 24;
frame.paddingRight = 24;
```

If you need a non-auto-layout frame, use `figma.createFrame()` and set the properties manually:

```javascript
const frame = figma.createFrame();
frame.layoutMode = "VERTICAL";              // or "HORIZONTAL"
frame.resize(360, 1);                        // Width fixed, height auto
frame.primaryAxisSizingMode = "AUTO";       // Hug main axis
frame.counterAxisSizingMode = "FIXED";      // Fixed cross axis
```

**CRITICAL ORDERING:** Always call `resize()` BEFORE setting sizing modes. The `resize()` method silently resets both sizing modes to FIXED, so calling it after setting `primaryAxisSizingMode = "AUTO"` will override your HUG settings and lock the frame to the exact pixel dimensions you passed (even throwaway values like `1`). This causes the common "1px dimension" bug.

### Alignment

```javascript
// Main axis (direction of layout)
frame.primaryAxisAlignItems = "MIN";            // Start
frame.primaryAxisAlignItems = "CENTER";         // Center
frame.primaryAxisAlignItems = "MAX";            // End
frame.primaryAxisAlignItems = "SPACE_BETWEEN";  // Distribute

// Cross axis
frame.counterAxisAlignItems = "MIN";     // Start
frame.counterAxisAlignItems = "CENTER";  // Center
frame.counterAxisAlignItems = "MAX";     // End
// NOTE: 'STRETCH' is NOT valid — use 'MIN' + child.layoutSizingX = 'FILL'
```

### Child Sizing

```javascript
// FILL requires an auto-layout parent and must be set after appendChild.
const parent = figma.createAutoLayout("VERTICAL");
parent.appendChild(child)
child.layoutSizingHorizontal = "FILL";   // Stretch to parent
child.layoutSizingVertical = "FIXED";

// HUG is valid for nodes with intrinsic content, such as text and auto-layout frames.
// Append the node to its auto-layout parent before assigning HUG.
parent.appendChild(textChild);
textChild.layoutSizingHorizontal = "HUG";
```

### Wrapping (Grid-like Layout)

```javascript
frame.layoutMode = "HORIZONTAL";
frame.layoutWrap = "WRAP";
frame.itemSpacing = 24;          // Horizontal gap
frame.counterAxisSpacing = 24;   // Vertical gap (between rows)
```

### Absolute Positioning Within Auto Layout

```javascript
// ABSOLUTE also requires the child to be attached to an auto-layout parent first.
const parent = figma.createAutoLayout("HORIZONTAL");
parent.appendChild(child);
child.layoutPositioning = "ABSOLUTE";
child.constraints = { horizontal: "MAX", vertical: "MIN" };  // Top-right
child.x = parentWidth - childWidth - 8;
child.y = 8;
```

## Effects

### Drop Shadow

```javascript
node.effects = [{
  type: "DROP_SHADOW",
  color: { r: 0, g: 0, b: 0, a: 0.08 },
  offset: { x: 0, y: 4 },
  radius: 16,
  spread: -2,
  visible: true,
  blendMode: "NORMAL"
}];
```

### Inner Shadow

```javascript
node.effects = [{
  type: "INNER_SHADOW",
  color: { r: 0, g: 0, b: 0, a: 0.05 },
  offset: { x: 0, y: 1 },
  radius: 2,
  spread: 0,
  visible: true,
  blendMode: "NORMAL"
}];
```

### Background Blur

```javascript
node.effects = [{
  type: "BACKGROUND_BLUR",
  radius: 16,
  visible: true
}];
```

### Layer Blur

```javascript
node.effects = [{
  type: "LAYER_BLUR",
  radius: 8,
  visible: true
}];
```

### Multiple Effects

```javascript
node.effects = [
  { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.04 }, offset: { x: 0, y: 1 }, radius: 3, spread: 0, visible: true, blendMode: "NORMAL" },
  { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 8 }, radius: 24, spread: -4, visible: true, blendMode: "NORMAL" }
];
```

## Opacity & Blend Modes

```javascript
node.opacity = 0.5;
node.blendMode = "NORMAL";    // "MULTIPLY", "SCREEN", "OVERLAY", "DARKEN", "LIGHTEN", etc.
```

## Corner Radius

```javascript
// Uniform
node.cornerRadius = 12;

// Per-corner
node.topLeftRadius = 12;
node.topRightRadius = 12;
node.bottomLeftRadius = 0;
node.bottomRightRadius = 0;
```

## Clipping

```javascript
frame.clipsContent = true;   // Children clipped to frame bounds
```

## Grouping & Organization

### Groups

```javascript
const group = figma.group([node1, node2, node3], figma.currentPage);
group.name = "Grouped Elements";
```

### Sections

```javascript
const section = figma.createSection();
section.name = "My Section";
section.resize(800, 600); // `resize` and `resizeWithoutConstraints` are equivalent on sections
section.x = 0;
section.y = 0;
// IMPORTANT: Sections don't auto-resize — always resize after adding content
```

### Appending Children

```javascript
parentFrame.appendChild(childNode);

// Insert at a specific index
parentFrame.insertChild(0, childNode);  // Insert at beginning
```

## Components & Variants

### Create Component

```javascript
const component = figma.createComponent();
component.name = "Button/Primary";
component.description = "Primary action button.";
```

### Create Instance

```javascript
const instance = component.createInstance();
instance.x = 200;
instance.y = 100;
```

### Import Components by Key (Team Libraries)

These methods import components from **team libraries** (not the same file). For components in the current file, use `figma.getNodeByIdAsync()` or `findOne()`/`findAll()`.

```javascript
// Batch independent imports with Promise.all — sequential awaits multiply
// IPC latency by the number of imports for no benefit.
const [comp, set] = await Promise.all([
  figma.importComponentByKeyAsync(componentKey),
  figma.importComponentSetByKeyAsync(componentSetKey),
])

const instance = comp.createInstance()
const variant = set.defaultVariant
const variantInstance = variant.createInstance()
```

### Combine as Variants

```javascript
// IMPORTANT: Pass ComponentNodes (not frames)
const componentSet = figma.combineAsVariants(
  [variantA, variantB, variantC],
  figma.currentPage
);
componentSet.name = "Button";
componentSet.description = "Button component with multiple variants.";

// CRITICAL: Layout variants in a grid after combining (they stack at 0,0)
let maxX = 0, maxY = 0;
componentSet.children.forEach((child, i) => {
  child.x = (i % numCols) * colWidth;
  child.y = Math.floor(i / numCols) * rowHeight;
});
for (const child of componentSet.children) {
  maxX = Math.max(maxX, child.x + child.width);
  maxY = Math.max(maxY, child.y + child.height);
}
componentSet.resizeWithoutConstraints(maxX + 40, maxY + 40);
```

### Component Properties
```javascript
// addComponentProperty returns a STRING key — capture it!
const labelKey = component.addComponentProperty("label", "TEXT", "Button");
const showIconKey = component.addComponentProperty("showIcon", "BOOLEAN", true);
const iconSlotKey = component.addComponentProperty("iconSlot", "INSTANCE_SWAP", defaultIconId);
// MUST narrow each child to the type supported by the referenced property
if ("characters" in labelNode) {
  labelNode.componentPropertyReferences = { characters: labelKey };
}
iconInstance.componentPropertyReferences = {
  visible: showIconKey,
  mainComponent: iconSlotKey
};
```

## Styles

### Text Style

```javascript
// Load font BEFORE setting style.fontName — required for every font, not just Inter
await figma.loadFontAsync({ family: "Inter", style: "Regular" });

const style = figma.createTextStyle();
style.name = "Body/Default";
style.fontName = { family: "Inter", style: "Regular" };
style.fontSize = 16;
style.lineHeight = { value: 24, unit: "PIXELS" };
style.letterSpacing = { value: 0, unit: "PERCENT" };

// Apply to a text node
textNode.textStyleId = style.id;
```

### Effect Style

```javascript
const shadowStyle = figma.createEffectStyle();
shadowStyle.name = "Shadow/Subtle";
shadowStyle.effects = [{
  type: "DROP_SHADOW",
  color: { r: 0, g: 0, b: 0, a: 0.06 },
  offset: { x: 0, y: 2 },
  radius: 8,
  spread: 0,
  visible: true,
  blendMode: "NORMAL"
}];

// Apply to a node
frame.effectStyleId = shadowStyle.id;
```

## Cloning & Duplication

```javascript
const clone = originalNode.clone();
clone.x = originalNode.x + originalNode.width + 40;
clone.name = "Copy of " + originalNode.name;
```

## Finding Nodes

```javascript
// If you already have the node's ID, NEVER scan — use the indexed lookup.
const known = await figma.getNodeByIdAsync("123:456");

// Find by name on current page (no ID available)
const node = figma.currentPage.findOne(n => n.name === "My Frame");

// Find all by type — use findAllWithCriteria, hundreds of times faster than
// findAll(n => n.type === '…') because the engine uses an internal type index.
const allTexts = figma.currentPage.findAllWithCriteria({ types: ["TEXT"] });

// Find all by name pattern (predicate is fine — criteria doesn't index name)
const allButtons = figma.currentPage.findAll(n => n.name.startsWith("Button/"));
```

## Layout Grids

```javascript
frame.layoutGrids = [
  {
    pattern: "COLUMNS",
    alignment: "STRETCH",
    count: 12,
    gutterSize: 24,
    offset: 80,
    visible: true
  }
];
```

## Constraints (Non-Auto-Layout Frames)

```javascript
child.constraints = {
  horizontal: "LEFT_RIGHT",  // LEFT, RIGHT, CENTER, LEFT_RIGHT, SCALE
  vertical: "TOP"            // TOP, BOTTOM, CENTER, TOP_BOTTOM, SCALE
};
```

## Viewport & Zoom

```javascript
// Zoom to fit specific nodes
figma.viewport.scrollAndZoomIntoView([frame1, frame2]);
```
