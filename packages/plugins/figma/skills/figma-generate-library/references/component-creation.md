> Part of the [figma-generate-library skill](../SKILL.md).

# Component Creation Reference

Guide to building components with variant matrices, variable bindings, component properties, and optional documentation. The scope selected in the main skill determines which sections apply.

> **Design files only.** Every snippet here (including `figma.createPage()`) targets Figma Design files (`figma.com/design/...`). `figma.createPage()` throws in both FigJam (`figma.com/board/...`) and Slides (`figma.com/slides/...`).
>
> **Every text mutation in this file follows the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids):** load font → `await` → mutate → return affected IDs. Examples use `Inter` because it's available everywhere; `loadFontAsync` is required for every (family, style) pair you mutate, including non-Inter brand fonts.

---

## 1. Component Architecture

### Dependency Ordering: Atoms Before Molecules

Always build in dependency order. A molecule that contains an atom instance cannot exist until the atom is published. Suggested ordering:

```
Tier 0 (atoms): Icon, Avatar, Badge, Spinner
Tier 1 (molecules): Button, Checkbox, Toggle, Input, Select
Tier 2 (organisms): Card, Dialog, Menu, Navigation, Form
```

If a component embeds an instance of another component, create that dependency first. Build the relevant dependency graph during discovery and encode the creation order in the plan.

### Building Blocks Sub-Components (M3 Pattern)

For complex components with independent sub-element state machines, extract the sub-element into its own component set prefixed with `Building Blocks/` (public) or `.Building Blocks/` (hidden from assets panel). The dot-prefix is a Figma convention for suppressing a component from the public assets panel.

**When to use Building Blocks:**
- The sub-element has its own variant axes (state, selection) that would cause combinatorial explosion in the parent
- The sub-element repeats (nav items, table cells, calendar cells, segmented button segments)
- The sub-element has different variant axes than the parent

**Example (M3 Segmented Button):**
```
Building Blocks/Segmented button/Button segment (start)   [27 variants: Config × State × Selected]
Building Blocks/Segmented button/Button segment (middle)  [27 variants]
Building Blocks/Segmented button/Button segment (end)     [27 variants]

Segmented button  [16 variants: Segments=2-5 × Density=0/-1/-2/-3]
  Each variant contains instances of the appropriate Building Block segment components.
```

The parent manages composition and configuration; the Building Block manages its own interaction states.

### Private Components (`__` Prefix)

Use the `__` prefix for internal helper components that should not appear in the team library (Shop Minis pattern). Use `_` for documentation-only components (UI3 pattern).

```
__asset          // private icon/asset holder
_Label/Direction // documentation annotation helper
```

---

## 2. Creating the Component Page

For a full library, each component usually lives on a dedicated page with documentation and its component set. For a scoped component task, match the file's existing organization and create a page or documentation only when the selected scope requires it.

```javascript
// Create or find the component page
let page = figma.root.children.find(p => p.name === 'Button');
if (!page) {
  page = figma.createPage();
  page.name = 'Button';
}
await figma.setCurrentPageAsync(page);

// Documentation frame — positioned at (40, 40)
const docFrame = figma.createFrame();
docFrame.name = 'Button / Documentation';
docFrame.x = 40;
docFrame.y = 40;
docFrame.resize(600, 400);
docFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
docFrame.layoutMode = 'VERTICAL';
docFrame.primaryAxisSizingMode = 'AUTO';
docFrame.counterAxisSizingMode = 'FIXED';
docFrame.paddingTop = 40;
docFrame.paddingBottom = 40;
docFrame.paddingLeft = 40;
docFrame.paddingRight = 40;
docFrame.itemSpacing = 16;

// Title text node
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
const title = figma.createText();
title.fontName = { family: 'Inter', style: 'Bold' };
title.fontSize = 32;
title.characters = 'Button';
docFrame.appendChild(title);

// Description text node
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const desc = figma.createText();
desc.fontName = { family: 'Inter', style: 'Regular' };
desc.fontSize = 14;
desc.characters = 'Buttons allow users to take actions and make choices with a single tap.';
docFrame.appendChild(desc);

return { docFrameId: docFrame.id, pageId: page.id };
```

---

## 3. Base Component: Auto-Layout, Child Nodes, Variable Bindings

The base component is the template from which all variants are cloned. It must have:
1. Auto-layout (not manual positioning)
2. All child nodes present
3. ALL visual properties bound to variables (no hardcoded values)

### Complete Button Base Component Example

```javascript
const page = await figma.getNodeByIdAsync('PAGE_ID_FROM_STATE');
if (!page || page.type !== 'PAGE') throw new Error('Expected the selected component page');
await figma.setCurrentPageAsync(page);

// Rehydrate variables from IDs stored in state ledger
const bgVar     = await figma.variables.getVariableByIdAsync('VAR_ID_color_bg_primary');
const textVar   = await figma.variables.getVariableByIdAsync('VAR_ID_color_text_on_primary');
const paddingVar = await figma.variables.getVariableByIdAsync('VAR_ID_spacing_md');
const radiusVar = await figma.variables.getVariableByIdAsync('VAR_ID_radius_md');
const gapVar    = await figma.variables.getVariableByIdAsync('VAR_ID_spacing_sm');

// --- Base component frame ---
const comp = figma.createComponent();
comp.name = 'Size=Medium, Style=Primary, State=Default';
comp.layoutMode = 'HORIZONTAL';
comp.primaryAxisSizingMode = 'AUTO';
comp.counterAxisSizingMode = 'AUTO';
comp.counterAxisAlignItems = 'CENTER';
comp.primaryAxisAlignItems = 'CENTER';

// Padding — bound to spacing variables
comp.setBoundVariable('paddingTop',    paddingVar);
comp.setBoundVariable('paddingBottom', paddingVar);
comp.setBoundVariable('paddingLeft',   paddingVar);
comp.setBoundVariable('paddingRight',  paddingVar);
comp.setBoundVariable('itemSpacing',   gapVar);

// Corner radius — bound to radius variable
comp.setBoundVariable('topLeftRadius',     radiusVar);
comp.setBoundVariable('topRightRadius',    radiusVar);
comp.setBoundVariable('bottomLeftRadius',  radiusVar);
comp.setBoundVariable('bottomRightRadius', radiusVar);

// Background fill — bound to color variable
const bgPaint = figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
  'color',
  bgVar
);
comp.fills = [bgPaint];

// --- Label text node ---
await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
const label = figma.createText();
label.name = 'label';
label.fontName = { family: 'Inter', style: 'Medium' };
label.fontSize = 14;
label.characters = 'Button';

// Text fill — bound to color variable
const textPaint = figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 1, g: 1, b: 1 } },
  'color',
  textVar
);
label.fills = [textPaint];
comp.appendChild(label);
label.layoutSizingHorizontal = 'HUG';
label.layoutSizingVertical = 'HUG';

// --- Icon placeholder (Rectangle for now — will be INSTANCE_SWAP) ---
const iconBox = figma.createFrame();
iconBox.name = 'icon';
iconBox.resize(16, 16);
iconBox.fills = [];
iconBox.layoutSizingHorizontal = 'FIXED';
iconBox.layoutSizingVertical = 'FIXED';
comp.appendChild(iconBox);

return { baseCompId: comp.id };
```

**ALL of these must be variable-bound (never hardcoded):**

| Property | Variable type | API method |
|---|---|---|
| Fill color | COLOR | `setBoundVariableForPaint(..., 'color', var)` |
| Stroke color | COLOR | `setBoundVariableForPaint(..., 'color', var)` |
| Text fill | COLOR | `setBoundVariableForPaint(..., 'color', var)` |
| Padding (all 4 sides) | FLOAT | `comp.setBoundVariable('paddingTop', var)` |
| Gap / itemSpacing | FLOAT | `comp.setBoundVariable('itemSpacing', var)` |
| Corner radius (all 4) | FLOAT | `comp.setBoundVariable('topLeftRadius', var)` etc. |
| Stroke weight | FLOAT | `comp.setBoundVariable('strokeWeight', var)` |

---

## 4. Variant Matrix

### Defining Axes

For each component, identify its variant axes before writing any code. Standard axes:

```
Button:
  Size   → [Small, Medium, Large]
  Style  → [Primary, Secondary, Outline, Ghost]
  State  → [Default, Hover, Focused, Pressed, Disabled]
  Total  = 3 × 4 × 5 = 60 combinations — exceeds 30 limit → split by Style
```

### The 30-Combination Cap and Split Strategy

When the product of all variant axes exceeds 30 combinations, split the matrix. Options:

1. **Split by a primary axis**: Create separate component sets, one per Style (Primary Button, Secondary Button, etc.)
2. **Use INSTANCE_SWAP**: Remove a visual axis (like Icon) from the variant matrix entirely and expose it as an INSTANCE_SWAP property instead
3. **Use Building Blocks**: Extract sub-elements with their own state axes into Building Block component sets

For Button with Size × State = 15 combinations, add Style as a variant axis only if Style ≤ 2 options (15 × 2 = 30). For more Styles, split.

### Creating All Variants with use_figma

Build each variant by cloning the base component and adjusting the variable bindings that differ per variant. Pass in the base component ID from the previous call's state.

```javascript
const BASE_COMP_ID = 'BASE_ID_FROM_STATE'; // from state ledger

const page = await figma.getNodeByIdAsync('PAGE_ID_FROM_STATE');
if (!page || page.type !== 'PAGE') throw new Error('Expected the selected component page');
await figma.setCurrentPageAsync(page);

const base = await figma.getNodeByIdAsync(BASE_COMP_ID);

// Variable IDs from state ledger
const vars = {
  // Primary style
  bg_primary:    await figma.variables.getVariableByIdAsync('VAR_ID_color_bg_primary'),
  text_primary:  await figma.variables.getVariableByIdAsync('VAR_ID_color_text_on_primary'),
  // Secondary style
  bg_secondary:  await figma.variables.getVariableByIdAsync('VAR_ID_color_bg_secondary'),
  text_secondary: await figma.variables.getVariableByIdAsync('VAR_ID_color_text_secondary'),
  // Disabled
  bg_disabled:   await figma.variables.getVariableByIdAsync('VAR_ID_color_bg_disabled'),
  text_disabled: await figma.variables.getVariableByIdAsync('VAR_ID_color_text_disabled'),
  // Sizes
  padding_sm: await figma.variables.getVariableByIdAsync('VAR_ID_spacing_sm'),
  padding_md: await figma.variables.getVariableByIdAsync('VAR_ID_spacing_md'),
  padding_lg: await figma.variables.getVariableByIdAsync('VAR_ID_spacing_lg'),
};

const axes = {
  Size:  ['Small', 'Medium', 'Large'],
  Style: ['Primary', 'Secondary'],
  State: ['Default', 'Hover', 'Disabled'],
};

const paddingBySize = { Small: vars.padding_sm, Medium: vars.padding_md, Large: vars.padding_lg };

const components = [];

for (const size of axes.Size) {
  for (const style of axes.Style) {
    for (const state of axes.State) {
      const clone = base.clone();
      clone.name = `Size=${size}, Style=${style}, State=${state}`;

      // Bind padding by size
      clone.setBoundVariable('paddingTop',    paddingBySize[size]);
      clone.setBoundVariable('paddingBottom', paddingBySize[size]);
      clone.setBoundVariable('paddingLeft',   paddingBySize[size]);
      clone.setBoundVariable('paddingRight',  paddingBySize[size]);

      // Bind fill by style + state
      const isDisabled = state === 'Disabled';
      const bgVar  = isDisabled ? vars.bg_disabled  : (style === 'Primary' ? vars.bg_primary  : vars.bg_secondary);
      const txtVar = isDisabled ? vars.text_disabled : (style === 'Primary' ? vars.text_primary : vars.text_secondary);

      const bgPaint = figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', bgVar
      );
      clone.fills = [bgPaint];

      const labelNode = clone.findOne(n => n.name === 'label');
      const textPaint = figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }, 'color', txtVar
      );
      labelNode.fills = [textPaint];


      components.push(clone);
    }
  }
}

return { variantIds: components.map(c => c.id) };
```

---

## 5. `combineAsVariants` + Grid Layout

After all variant components exist, combine them into a ComponentSet and position them in a grid. This MUST be a separate `use_figma` call — you must pass in all variant IDs from the previous call's return value.

### Grid Design Conventions

Professional design systems lay out variants in a readable grid where:
- **Columns** = the property users interact with most (typically **State**: Default, Hover, Focused, Pressed, Disabled)
- **Rows** = structural axes grouped together (typically **Size × Style**, where Size varies fastest)
- **Gap** = 16–40px between variants (20px is a safe default; match existing file if one exists)
- **Padding** = 40px around the grid inside the ComponentSet frame

```
Visual structure:
                    Default    Hover     Focused   Pressed   Disabled
  ┌──────────────────────────────────────────────────────────────────┐
  │  Small/Primary   [comp]    [comp]    [comp]    [comp]    [comp] │
  │  Small/Secondary [comp]    [comp]    [comp]    [comp]    [comp] │
  │  Medium/Primary  [comp]    [comp]    [comp]    [comp]    [comp] │
  │  Medium/Secondary[comp]    [comp]    [comp]    [comp]    [comp] │
  │  Large/Primary   [comp]    [comp]    [comp]    [comp]    [comp] │
  │  Large/Secondary [comp]    [comp]    [comp]    [comp]    [comp] │
  └──────────────────────────────────────────────────────────────────┘
```

**Why State on columns?** State is the axis designers scan horizontally to verify interaction consistency. Size/Style define the "identity" of each row. This matches how professional design systems (M3, Polaris, Simple DS) organize their grids.

### Adding Row/Column Header Labels

After laying out the grid, add text labels OUTSIDE the ComponentSet to help navigation. These are siblings of the ComponentSet on the page — not children of it:

```javascript
// Add column headers above the component set
const colLabels = ['Default', 'Hover', 'Focused', 'Pressed', 'Disabled'];
await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
for (let i = 0; i < colLabels.length; i++) {
  const label = figma.createText();
  label.fontName = { family: 'Inter', style: 'Medium' };
  label.characters = colLabels[i];
  label.fontSize = 11;
  label.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }];
  label.x = cs.x + padding + i * (childWidth + gap);
  label.y = cs.y - 20;
}

// Add row headers to the left of the component set
const rowLabels = ['Small / Primary', 'Small / Secondary', 'Med / Primary', ...];
for (let i = 0; i < rowLabels.length; i++) {
  const label = figma.createText();
  label.fontName = { family: 'Inter', style: 'Medium' };
  label.characters = rowLabels[i];
  label.fontSize = 11;
  label.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }];
  label.x = cs.x - 120;
  label.y = cs.y + padding + i * (childHeight + gap) + childHeight / 2 - 6;
}
```

**Note:** These labels are documentation aids, not part of the component itself. They help designers navigate the variant grid.

### Grid layout code

```javascript
const VARIANT_IDS = ['ID1', 'ID2', '...']; // from state ledger
const PAGE_ID = 'PAGE_ID'; // from state ledger

await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(PAGE_ID));

// Collect component nodes
const components = await Promise.all(
  VARIANT_IDS.map(id => figma.getNodeByIdAsync(id))
);

// Combine as variants
const cs = figma.combineAsVariants(components, figma.currentPage);
cs.name = 'Button';

// Grid layout: position each variant based on its property values
// Determine column axis (State) and row axes (Size × Style)
const axes = {
  Size:  ['Small', 'Medium', 'Large'],
  Style: ['Primary', 'Secondary'],
  State: ['Default', 'Hover', 'Disabled'],
};
const COL_AXIS = 'State';  // columns
const ROW_AXES = ['Size', 'Style']; // rows (Size changes fastest)

const gap = 16;
const padding = 40;

// Measure child dimensions (all should be same height within Size tier)
// Use the first child as reference for column width
const childWidth  = 120; // approximate; refine after first screenshot
const childHeight = 40;

cs.children.forEach(child => {
  const props = {};
  child.name.split(', ').forEach(part => {
    const [k, v] = part.split('=');
    props[k] = v;
  });

  const colIdx = axes[COL_AXIS].indexOf(props[COL_AXIS]);
  // Row = Size index * number of styles + Style index
  const rowIdx = axes.Size.indexOf(props.Size) * axes.Style.length
               + axes.Style.indexOf(props.Style);

  child.x = padding + colIdx * (childWidth  + gap);
  child.y = padding + rowIdx * (childHeight + gap);
});

// Resize component set to fit all children + padding
let maxX = 0, maxY = 0;
for (const child of cs.children) {
  maxX = Math.max(maxX, child.x + child.width);
  maxY = Math.max(maxY, child.y + child.height);
}
cs.resizeWithoutConstraints(maxX + padding, maxY + padding);

// Style the component set frame
cs.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.98 } }];
cs.cornerRadius = 8;

// Position component set on page (to the right of doc frame)
cs.x = 680;
cs.y = 40;


return { componentSetId: cs.id };
```

**Critical rules for combineAsVariants:**
- `components` must be a non-empty array containing ONLY `ComponentNode` objects (not frames, not groups)
- After combining, children are placed at (0,0) and overlap — you MUST manually position them
- `resizeWithoutConstraints` is required after positioning to make the component set frame fit its contents
- There is no `figma.createComponentSet()` — you cannot create an empty component set

---

## 6. Component Properties

Add TEXT, BOOLEAN, and INSTANCE_SWAP properties to the ComponentSet (not to individual variants). The return value of `addComponentProperty` is the actual property key (it gets a `#id:id` suffix appended) — save this key and use it immediately when setting `componentPropertyReferences`.

### TEXT Properties

Expose editable text in instances:
```javascript
// On the ComponentSetNode (cs):
const labelKey = cs.addComponentProperty('Label', 'TEXT', 'Button');
// labelKey is now something like "Label#0:1"
// Wire to the label child in each variant:
for (const child of cs.children) {
  const labelNode = child.findOne(
    n => n.name === 'label' && 'characters' in n,
  );
  if (labelNode) {
    labelNode.componentPropertyReferences = { characters: labelKey };
  }
}
```

### BOOLEAN Properties

Toggle child node visibility:

```javascript
const showIconKey = cs.addComponentProperty('Show Icon', 'BOOLEAN', true);

for (const child of cs.children) {
  const iconNode = child.findOne(n => n.name === 'icon');
  if (iconNode) {
    iconNode.componentPropertyReferences = { visible: showIconKey };
  }
}
```

### INSTANCE_SWAP Properties

Allow swapping a nested component instance (e.g., swap the icon):

```javascript
// defaultIconCompId is the ID of the default icon component (from state ledger)
const iconKey = cs.addComponentProperty('Icon', 'INSTANCE_SWAP', DEFAULT_ICON_COMP_ID);

for (const child of cs.children) {
  const iconSlot = child.findOne(n => n.name === 'icon');
  if (iconSlot && iconSlot.type === 'INSTANCE') {
    iconSlot.componentPropertyReferences = { mainComponent: iconKey };
  }
}
```

**Use INSTANCE_SWAP instead of creating a variant per icon.** Never add "Icon=ChevronRight, Icon=ChevronLeft, ..." as VARIANT axes — that causes combinatorial explosion. One INSTANCE_SWAP property covers all icons.

### Creating Icon Components for INSTANCE_SWAP

INSTANCE_SWAP needs a real Component ID as its default value. Before wiring INSTANCE_SWAP, you need at least one icon component. Here's how to create icons from SVG:

```javascript
// Create a simple icon component from SVG
const svgNode = figma.createNodeFromSvg(
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'
);

// Wrap in a component
const iconComp = figma.createComponent();
iconComp.name = 'Icon/ChevronRight';
iconComp.resize(24, 24);
iconComp.clipsContent = true;

// Move SVG children into the component
for (const child of [...svgNode.children]) {
  iconComp.appendChild(child);
}
svgNode.remove();

// Bind the icon fill to a color variable (so it respects themes)
// Find vector children and bind their fills
iconComp.findAllWithCriteria({ types: ['VECTOR'] }).forEach(vec => {
  // For stroke-based icons:
  if (vec.strokes.length > 0) {
    const strokePaint = figma.variables.setBoundVariableForPaint(
      { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', iconColorVar
    );
    vec.strokes = [strokePaint];
  }
});


return { iconCompId: iconComp.id };
```
**Then use the returned `iconCompId` as the default value for INSTANCE_SWAP:**
```javascript
const iconKey = cs.addComponentProperty('Icon', 'INSTANCE_SWAP', ICON_COMP_ID);
```

**Constraining swap options with `preferredValues`:**
After adding the INSTANCE_SWAP property, you can optionally limit which components appear in the swap picker:
```javascript
const propertyOwner = cs?.type === 'COMPONENT' && cs.parent?.type === 'COMPONENT_SET' ? cs.parent : cs;
if (!propertyOwner || !['COMPONENT', 'COMPONENT_SET'].includes(propertyOwner.type)) throw new Error('Expected a component set or non-variant component');
const props = propertyOwner.componentPropertyDefinitions;
const iconPropKey = Object.keys(props).find(k => k.startsWith('Icon'));

// Set preferred values (array of component keys or instance IDs)
propertyOwner.editComponentProperty(iconPropKey, {
  preferredValues: [
    { type: 'COMPONENT', key: chevronRightComp.key },
    { type: 'COMPONENT', key: chevronLeftComp.key },
    { type: 'COMPONENT', key: closeComp.key },
  ],
});
```

**Icon library tip:** Create all icon components on a dedicated `Icons` page before building any UI components. Then reference their IDs when wiring INSTANCE_SWAP properties.

### `componentPropertyReferences` mapping

The `componentPropertyReferences` object maps a node's own property to a component property key:

| Node property | Component property type | Used for |
|---|---|---|
| `characters` | TEXT | Editable text content |
| `visible` | BOOLEAN | Show/hide toggle |
| `mainComponent` | INSTANCE_SWAP | Swap nested instances |

---

## 7. Documentation

### Page title + description frame

The documentation frame (see Section 2) should contain:
1. Component name as a large title (32px+ Bold)
2. 1–3 sentence description of what the component is and when to use it
3. Spec notes (sizes, spacing values, accessibility notes)

### Component `description` property

Set the description on the ComponentSet — it appears in the Figma properties panel and is exported as documentation:

```javascript
cs.description = 'Buttons allow users to take actions and make choices. Use Primary for the highest-emphasis action on a page.';
```

### `documentationLinks`

Link to external documentation (Storybook, design spec, tokens reference):

```javascript
cs.documentationLinks = [
  { uri: 'https://your-storybook.com/button' }
];
```

### Node names and organization

- ComponentSet: plain component name — `'Button'`
- Individual variants: `'Property=Value, Property=Value'` format (match the file's existing casing)
- Child nodes: semantic names — `'label'`, `'icon'`, `'container'`, `'state-layer'`
- Documentation frames: `'ComponentName / Documentation'`

---

## 8. Validation

Always validate after creating or modifying a component before proceeding to the next one.

### `get_metadata` structural checks

After creating the component set, call `get_metadata` on the `COMPONENT_SET` node ID (never an individual variant component ID) and verify:
- `variantGroupProperties` lists the expected axes with the correct value arrays
- `componentPropertyDefinitions` contains the expected TEXT/BOOLEAN/INSTANCE_SWAP properties
- `children.length` equals the expected variant count (e.g., 18 for 3×2×3)
- No children are named `'Component 1'` (unnamed components are a sign of a bug)

### `get_screenshot` — Visual Validation (Critical)

`get_screenshot` returns an **image** of the specified node. When documentation is in scope, capture the component page or documentation container. Otherwise capture the component set or its containing frame so validation does not require a new page.

```
Tool: get_screenshot
Args: { nodeId: "COMPONENT_SET_OR_CONTAINER_ID", fileKey: "FILE_KEY" }
```

**How to use the screenshot:**

1. **Display it to the user** as validation evidence for the completed component.
2. **Analyze it yourself** — if you have vision capabilities, check the visual checklist below. If you don't (text-only agent), fall back to structural validation via `get_metadata` and describe what you created.

**Visual validation checklist** (check each item when viewing the screenshot):

| # | Check | What "good" looks like | What "broken" looks like |
|---|-------|----------------------|------------------------|
| 1 | **Grid layout** | Variants in neat rows and columns with consistent spacing | All variants piled at top-left (0,0 stacking bug) |
| 2 | **Color fills** | Components show distinct, correct colors per style variant | All components are black or same color (variable binding failed) |
| 3 | **Size differentiation** | Small variants are visibly smaller than Large variants | All variants are the same size (height/padding not bound to variables) |
| 4 | **Text readability** | Labels are visible with correct font and color | Text is invisible (white on white), missing, or shows "undefined" |
| 5 | **Spacing/padding** | Interior padding visible, components aren't "shrink-wrapped" | Components look cramped or have no visible internal space |
| 6 | **State differentiation** | Hover/Pressed variants have visible color differences from Default | All states look identical (state-specific fills not applied) |
| 7 | **Disabled state** | Lower opacity or muted colors compared to active states | Disabled looks identical to Default |
| 8 | **Documentation frame, if included** | Title + description text visible above or beside the component grid | Included documentation is missing or overlaps the component set |
| 9 | **Grid labels** | Row/column headers visible around the component set (if added) | Labels overlap the grid or are missing |
| 10 | **Component set boundary** | Gray background frame wraps all variants with even padding | Frame is too small (variants clipped) or way too large |

**Screenshot → diagnosis → fix mapping:**

| Screenshot shows | Diagnosis | Fix script |
|-----------------|-----------|------------|
| All variants stacked top-left | Grid layout wasn't applied after `combineAsVariants` | Re-run the grid layout script (§5) |
| Everything black/same color | Variable bindings failed or variables don't have values for the active mode | Re-run variable binding, check mode values |
| No text visible | Font wasn't loaded, or text fill is same color as background | Call `listAvailableFontsAsync()` to verify the font exists, then check `loadFontAsync` was called before text writes; bind text fill to `color/text/*` variable |
| Variants all same size | Padding/height not bound to size variables | Re-run `bindVariablesToComponent` with size-specific tokens |
| Component set frame tiny | `resizeWithoutConstraints` wasn't called or used wrong dimensions | Re-calculate bounds from children and resize |
| Included doc frame overlaps components | Component set positioned at same x,y as doc frame | Move component set: `cs.x = docFrame.x + docFrame.width + 60` |

**When visual analysis isn't available:**
If your model can't process images (text-only mode), validate structurally instead:
1. Call `get_metadata` on the component set — verify child count, property definitions, variant names
2. Run an `use_figma` that samples key properties:
```javascript
const cs = await figma.getNodeByIdAsync(CS_ID);
const sample = cs.children.slice(0, 3).map(c => ({
  name: c.name,
  width: c.width, height: c.height,
  x: c.x, y: c.y,
  fills: c.fills?.map(f => f.type === 'SOLID' ?
    { r: f.color.r.toFixed(2), g: f.color.g.toFixed(2), b: f.color.b.toFixed(2), boundVar: f.boundVariables?.color?.id } : f.type
  ),
}));
return { sampleVariants: sample, totalChildren: cs.children.length };
```
This gives you positions (grid working?), dimensions (size differentiation?), and fill info (bindings working?) without needing vision.

**When to take a screenshot:**
- After each completed component or coherent component family in the selected scope
- After creating a foundations documentation page, when included
- During final QA for a full library
- Do NOT screenshot after every intermediate step (wastes tool calls)

### Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| All variants stacked at (0,0) | `combineAsVariants` was called but children were never repositioned | Re-run grid layout script |
| Variants show wrong colors | Variable bindings applied after `combineAsVariants` instead of before | Rebind on component set children |
| Variant count wrong | Clone loop indexing error | Print `components.map(c => c.name)` before combining |
| BOOLEAN property has no effect | `componentPropertyReferences` was set on the component set frame, not on the child node | Find the actual child node and set references there |
| INSTANCE_SWAP shows no swap option | Default value was not a valid component ID | Pass a real existing component ID as `defaultValue` |
| `combineAsVariants` throws | At least one node in the array is not a `ComponentNode` | Filter array: `nodes.filter(n => n.type === 'COMPONENT')` |
| `addComponentProperty` returns unexpected key | Expected — the key gets a `#id:id` suffix | Save the returned value immediately: `const key = cs.addComponentProperty(...)` |

---

## 9. Complete Worked Example: Button Component

This shows the full-library presentation sequence, including state passing between calls. For a scoped component in an existing component area, skip Calls 1–2, use that area's page ID, and begin at Call 3. Replace variable IDs with actual values from the state ledger.

### Call 1: Create the component page (full library or requested showcase only)

**Goal:** Create (or find) the Button page.
**State input:** None
**State output:** `{ pageId }`

```javascript
let page = figma.root.children.find(p => p.name === 'Button');
if (!page) { page = figma.createPage(); page.name = 'Button'; }
return { pageId: page.id };
```

### Call 2: Create documentation frame (when selected scope includes it)

**Goal:** Add title + description frame.
**State input:** `{ pageId }`
**State output:** `{ docFrameId }`

```javascript
const PAGE_ID = 'PAGE_ID_FROM_STATE';
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);

const existing = page
  .findAllWithCriteria({ types: ['FRAME'] })
  .filter(n => n.name === 'Button / Documentation');
if (existing.length > 0) {
  return { docFrameId: existing[0].id };
}

await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

const docFrame = figma.createFrame();
docFrame.name = 'Button / Documentation';
docFrame.x = 40; docFrame.y = 40;
docFrame.layoutMode = 'VERTICAL';
docFrame.primaryAxisSizingMode = 'AUTO';
docFrame.counterAxisSizingMode = 'FIXED';
docFrame.resize(560, 100);
docFrame.paddingTop = 40; docFrame.paddingBottom = 40;
docFrame.paddingLeft = 40; docFrame.paddingRight = 40;
docFrame.itemSpacing = 16;
docFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

const title = figma.createText();
title.fontName = { family: 'Inter', style: 'Bold' };
title.fontSize = 32;
title.characters = 'Button';
docFrame.appendChild(title);

const desc = figma.createText();
desc.fontName = { family: 'Inter', style: 'Regular' };
desc.fontSize = 14;
desc.characters = 'Buttons allow users to take actions with a single tap. Use Primary for the highest-emphasis action on a page, Secondary for supporting actions.';
docFrame.appendChild(desc);
desc.layoutSizingHorizontal = 'FILL';


return { docFrameId: docFrame.id };
```

### Call 3: Create base component

**Goal:** Create the base component with auto-layout and all variable bindings.
**State input:** `{ pageId }` + verified or newly created foundation variable IDs
**State output:** `{ baseCompId }`

*(See Section 3 for full code — substituting the actual variable IDs from the state ledger.)*

### Call 4: Create all variants

**Goal:** Clone base and produce all 18 variants (3 Size × 2 Style × 3 State).
**State input:** `{ pageId, baseCompId }` + variable IDs
**State output:** `{ variantIds: ['id1', 'id2', ..., 'id18'] }`

```javascript
const BASE_ID = 'BASE_COMP_ID_FROM_STATE';
const PAGE_ID = 'PAGE_ID_FROM_STATE';
// Variable IDs from state ledger:
const VAR = {
  bg_primary:     'VAR_ID_1',
  text_primary:   'VAR_ID_2',
  bg_secondary:   'VAR_ID_3',
  text_secondary: 'VAR_ID_4',
  bg_disabled:    'VAR_ID_5',
  text_disabled:  'VAR_ID_6',
  padding_sm:     'VAR_ID_7',
  padding_md:     'VAR_ID_8',
  padding_lg:     'VAR_ID_9',
};

const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);

const base = await figma.getNodeByIdAsync(BASE_ID);

// Load all variables in parallel — sequential awaits in the loop would
// serialize one IPC round-trip per variable.
const varEntries = Object.entries(VAR);
const fetched = await Promise.all(
  varEntries.map(([, id]) => figma.variables.getVariableByIdAsync(id))
);
const vars = {};
varEntries.forEach(([k], i) => { vars[k] = fetched[i]; });

const axes = {
  Size:  ['Small', 'Medium', 'Large'],
  Style: ['Primary', 'Secondary'],
  State: ['Default', 'Hover', 'Disabled'],
};
const paddingMap = { Small: vars.padding_sm, Medium: vars.padding_md, Large: vars.padding_lg };

const components = [];
for (const size of axes.Size) {
  for (const style of axes.Style) {
    for (const state of axes.State) {
      const clone = base.clone();
      clone.name = `Size=${size}, Style=${style}, State=${state}`;

      clone.setBoundVariable('paddingTop',    paddingMap[size]);
      clone.setBoundVariable('paddingBottom', paddingMap[size]);
      clone.setBoundVariable('paddingLeft',   paddingMap[size]);
      clone.setBoundVariable('paddingRight',  paddingMap[size]);

      const isDisabled = state === 'Disabled';
      const bgV  = isDisabled ? vars.bg_disabled  : (style === 'Primary' ? vars.bg_primary  : vars.bg_secondary);
      const txV  = isDisabled ? vars.text_disabled : (style === 'Primary' ? vars.text_primary : vars.text_secondary);

      clone.fills = [figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', bgV
      )];

      const labelNode = clone.findOne(n => n.name === 'label');
      labelNode.fills = [figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }, 'color', txV
      )];

      components.push(clone);
    }
  }
}

return { variantIds: components.map(c => c.id) };
```

### Call 5: combineAsVariants + grid layout

**Goal:** Combine all 18 variants into a ComponentSet and lay them out in a grid.
**State input:** `{ pageId, variantIds }` (18 IDs)
**State output:** `{ componentSetId }`

*(See Section 5 for full code.)*

### Call 6: Add component properties

**Goal:** Add TEXT, BOOLEAN, INSTANCE_SWAP properties and wire them to child nodes.
**State input:** `{ pageId, componentSetId }`
**State output:** `{ componentSetId, properties: { labelKey, showIconKey, iconKey } }`

```javascript
const CS_ID = 'CS_ID_FROM_STATE';
const DEFAULT_ICON_ID = 'ICON_COMP_ID_FROM_STATE';
const PAGE_ID = 'PAGE_ID_FROM_STATE';
const page = await figma.getNodeByIdAsync(PAGE_ID);
if (!page || page.type !== 'PAGE') throw new Error('Expected the selected component page');
await figma.setCurrentPageAsync(page);

const cs = await figma.getNodeByIdAsync(CS_ID);
cs.description = 'Buttons allow users to take actions and make choices with a single tap.';
cs.documentationLinks = [{ uri: 'https://your-storybook.com/button' }];
// Add properties — save returned keys
const labelKey    = cs.addComponentProperty('Label', 'TEXT', 'Button');
const showIconKey = cs.addComponentProperty('Show Icon', 'BOOLEAN', true);
const iconKey     = cs.addComponentProperty('Icon', 'INSTANCE_SWAP', DEFAULT_ICON_ID);
// Wire to children
for (const child of cs.children) {
  const labelNode = child.findOne(
    n => n.name === 'label' && 'characters' in n,
  );
  if (labelNode) labelNode.componentPropertyReferences = { characters: labelKey };

  const iconNode = child.findOne(n => n.name === 'icon');
  if (iconNode) {
    iconNode.componentPropertyReferences = {
      visible: showIconKey,
      ...(iconNode.type === 'INSTANCE' ? { mainComponent: iconKey } : {}),
    };
  }
}

return {
  componentSetId: cs.id,
  properties: { labelKey, showIconKey, iconKey },
};
```

### Call 7: Validate with get_metadata

**Goal:** Structural check — variant count, properties, axes.
**Action:** Call `get_metadata` on the `COMPONENT_SET` node ID from state, not on any child variant component. Verify in the result:
- `children.length === 18`
- `variantGroupProperties` has `Size`, `Style`, `State` keys with correct value arrays
- `componentPropertyDefinitions` has `Label`, `Show Icon`, `Icon` entries

### Call 8: Validate with get_screenshot

**Goal:** Visual check — layout, colors, text.
**Action:** Call `get_screenshot` on the component set or containing frame; use the Button page when documentation is in scope. Inspect the screenshot. If variants are stacked, re-run Call 5. If colors look wrong, inspect variable bindings.

### Completion check

After Call 8, inspect and show the screenshot as validation evidence. Repair defects in the selected scope; when its definition of done passes, stop or continue to the next in-scope component.
