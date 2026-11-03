---
name: figma-generate-design
description: "Use this skill alongside figma-use when the task involves translating an application page, view, or multi-section layout into Figma. Triggers: 'write to Figma', 'create in Figma from code', 'push page to Figma', 'take this app/page and build it in Figma', 'create a screen', 'build a landing page in Figma', 'update the Figma screen to match code', 'convert this modal/dialog/drawer/panel to Figma'. This is the preferred workflow skill whenever the user wants to build or update a full page, modal, dialog, drawer, sidebar, panel, or any composed multi-section view in Figma from code or a description. Discovers design system components, variables, and styles from Code Connect files, existing screens, and library search, then imports them and assembles views incrementally section-by-section using design system tokens instead of hardcoded values."
disable-model-invocation: false
---

# Build / Update Screens and Views from Design System

**Hard deliverable gate:** Code-to-design output must recreate the UI as editable text, components, icons, and hierarchy.
Treat any screenshot or flattened rendering of the complete UI only as a visual reference: never upload or import it into the deliverable, including as the wrapper fill or a child node, even if it exists in the repository or appears more pixel-accurate. Before completion, inspect the result; if the UI is not primarily represented by editable layers, rebuild it semantically or report failure.

Use this skill to create or update **screens, views, and multi-section UI containers** in Figma by **reusing the published design system** — components, variables, and styles — rather than drawing primitives with hardcoded values. This includes full pages, modals, dialogs, drawers, sidebars, panels, and any composed view with multiple sections. The key insight: the Figma file likely has a published design system with components, color/spacing variables, and text/effect styles that correspond to the codebase's UI components and tokens. Find and use those instead of drawing boxes with hex colors.

**MANDATORY**: You MUST also load [figma-use](../figma-use/SKILL.md) before any `use_figma` call. That skill contains critical rules (color ranges, font loading, etc.) that apply to every script you write.

**Always include `figma-generate-design` in the comma-separated `skillNames` parameter when calling `use_figma` as part of this skill. If this skill was loaded via an MCP resource, you MUST prefix the name with `resource:` (e.g. `resource:figma-generate-design`).** This is a logging parameter — it does not affect execution.

## HTML-to-Figma Exceptions

Use `html_to_figma` for initial creation in these cases:

- The input is an existing raw or static HTML document. Pass it directly to `html_to_figma`.
- The prompt asks to create a new design and there is no rendered UI implementation to reproduce. Create a self-contained HTML document and pass it to `html_to_figma`.

If `html_to_figma` is unavailable, follow the existing workflow below.

## Skill Boundaries

- Use this skill when the deliverable is a **composed Figma view** (new or updated) — full-page screens, modals, dialogs, drawers, sidebars, panels, or any multi-section container — built from design system component instances.
- If the user wants to create **new reusable components or variants**, use [figma-use](../figma-use/SKILL.md) directly.
- If the user wants to write **Code Connect mappings**, switch to [figma-code-connect](../figma-code-connect/SKILL.md).

## Prerequisites

- Figma MCP server must be connected
- The target Figma file must have a published design system with components (or access to a team library)
- User must provide a target Figma file (URL or `fileKey`). If they don't have one yet, invoke `/figma-create-new-file` (or call `create_new_file`) first and reuse the returned file_key. Both `use_figma` and `generate_figma_design` require an existing `fileKey`.
- Source code or description of the screen/view to build/update

## Parallel Workflow with generate_figma_design (Web Apps Only)

When building a screen from a **web app** that can be rendered in a browser, the best results come from running both approaches in parallel:

1. **In parallel:**
   - Start building the screen using this skill's workflow (use_figma + design system components) against the target Figma file (`fileKey`).
   - Run `generate_figma_design` against the **same `fileKey`** to capture a pixel-perfect screenshot of the running web app into that file. `generate_figma_design` always requires `fileKey` — if the user does not yet have a Figma file, first invoke `/figma-create-new-file` (or call the `create_new_file` MCP tool) to get one, and reuse that file_key for both this skill and the capture.
2. **Once both complete:** Update the use_figma output to match the pixel-perfect layout from the `generate_figma_design` capture. The capture provides the exact spacing, sizing, and visual treatment to aim for, while your use_figma output has proper component instances linked to the design system. If the capture contains images, transfer them to your use_figma output by copying `imageHash` values from the capture's image fills (see Step 5 for details).
3. **Once confirmed looking good:** Delete the `generate_figma_design` output — it was only used as a visual reference.

This combines the best of both: `generate_figma_design` gives pixel-perfect layout accuracy, while use_figma gives proper design system component instances that stay linked and updatable.

**This parallel workflow is MANDATORY when the source contains discrete content images used by the app, such as photos, avatars, logos, or icons. A screenshot or flattened rendering of the complete UI is a visual reference, not a content image.** The `use_figma` Plugin API cannot fetch external image URLs — it can only set image fills by copying `imageHash` values from nodes already in the file. `generate_figma_design` rasterizes all visible images into Figma, providing the hashes you need. If you skip the capture when these content images are present, their image frames will be left blank.

For non-web apps (iOS, Android, etc.) or when updating existing screens, use the standard workflow below.

## Required Workflow

**Follow these steps in order. Do not skip steps.**

> **Hard gates — forbidden shortcuts:**
>
> - **Forbidden:** `search_design_system` for component keys until 2a-i is complete and 2a-ii is attempted or logged N/A (e.g. "empty file, no existing screens").
> - **Forbidden:** Any `use_figma` call that mutates the canvas (Step 3+) until all Step 2 rows in the checklist below are filled in.

### Step 1: Understand the Deliverable

Before touching Figma, understand what you're building:

1. If building from code, read the relevant source files to understand the structure, sections, and which components are used.
2. Identify the major sections of the view (e.g., for a page: Header, Hero, Content Panels, Footer; for a modal: Title Bar, Form Sections, Action Bar; for a sidebar: Navigation, Content Area, Footer Actions).
3. For each section, list the UI components involved (buttons, inputs, cards, navigation pills, accordions, etc.).
4. **Identify the product's font family from the source. Do not default to Inter.** Find *which* typeface the product uses before writing any script. See [references/discover-product-font.md](references/discover-product-font.md) for where to look (CSS variables, component files) and how to resolve messy Figma font names.
5. **Check whether the view contains any images** (e.g., `<img>`, `<Image>`, background images, product photos, avatars, icons loaded from URLs). If it does and this is a web app, you **must** run the parallel `generate_figma_design` capture workflow — start it immediately alongside Step 2 so the capture runs while you discover components. See "Parallel Workflow with generate_figma_design" above.

### Step 2: Collect Component Keys, Variables, and Styles

You need three things from the design system: **components** (buttons, cards, etc.), **variables** (colors, spacing, radii), and **styles** (text styles, effect styles like shadows). Don't hardcode hex colors or pixel values when design system tokens exist.

#### 2a: Discover components


**2a-i — REQUIRED: Check Code Connect for needed components.** Starting from the component list you built in Step 1, check whether each component has a Code Connect file in the codebase. Code Connect files live next to the component source and are named by platform:

- **TypeScript/JS**: `*.figma.ts`, `*.figma.js`
- **React (parser-based)**: `*.figma.tsx`
- **Kotlin/Compose**: `.kt` files containing `@FigmaConnect`
- **Swift**: `.swift` files containing `FigmaConnect`

For each component you need (e.g., Button, Card, Input), search for its Code Connect file — glob or grep by component name (e.g., `**/Button.figma.tsx`, `**/Card.figma.ts`). Only read files that match components you actually need.

From each matching Code Connect file, extract the Figma component URL. Parse `fileKey` and `nodeId` from the URL (convert hyphens to colons: `123-456` → `123:456`). Then resolve component keys via `use_figma`:

**Example:** Code Connect file contains `// url=https://figma.com/design/ABC123/File?node-id=609-35535`. Parse `fileKey` = `ABC123`, `nodeId` = `609:35535`. Run `use_figma` against the **library file** (fileKey `ABC123`, not the target file) to resolve the key:

```js
const node = await figma.getNodeByIdAsync("609:35535");
const set = node?.parent?.type === "COMPONENT_SET" ? node.parent : node;
return { componentKey: set.key };
```

Batch multiple lookups in a single call. Use the returned keys with `importComponentSetByKeyAsync()` in Step 4.

Mark resolved components. If all components are resolved, skip 2a-ii and 2a-iii. If none of the needed components have Code Connect files, proceed to 2a-ii.

**2a-ii — REQUIRED if unresolved components remain: Inspect existing screens.** Check if the target file already contains screens using the same design system. One read-only `use_figma` call inventories an existing frame — its component keys, bound variables, and text/effect styles — in a single authoritative pass. Run it once here and reuse the result in 2b and 2c rather than re-walking the frame:

```js
const frame = figma.currentPage.findOne(n => n.name === "Existing Screen");
const components = new Map();
const styles = { text: new Map(), effect: new Map() };
const variableIds = new Set();

// boundVariables and style ids can sit on any scene node, so walk them all.
for (const node of frame?.findAll(() => true) ?? []) {
  if (node.type === "INSTANCE") {
    const mc = node.mainComponent;
    const cs = mc?.parent?.type === "COMPONENT_SET" ? mc.parent : null;
    const key = cs ? cs.key : mc?.key;
    if (key && !components.has(key)) {
      components.set(key, { name: cs ? cs.name : mc.name, key, isSet: !!cs, sampleVariant: mc.name });
    }
  }
  for (const b of Object.values(node.boundVariables ?? {}).flat()) {
    if (b?.id) variableIds.add(b.id);
  }
  for (const [prop, bucket] of [["textStyleId", "text"], ["effectStyleId", "effect"]]) {
    if (prop in node && typeof node[prop] === "string" && node[prop]) {
      const s = figma.getStyleById(node[prop]);
      if (s) styles[bucket].set(s.id, { name: s.name, id: s.id, key: s.key });
    }
  }
}
const vars = await Promise.all([...variableIds].map(id => figma.variables.getVariableByIdAsync(id)));

return {
  components: [...components.values()],
  variables: vars.filter(Boolean).map(v => ({ name: v.name, id: v.id, key: v.key, type: v.resolvedType, remote: v.remote })),
  textStyles: [...styles.text.values()],
  effectStyles: [...styles.effect.values()],
};
```

Match `components` against your unresolved components; Code Connect keys from 2a-i stay authoritative. Mark any newly resolved. If all components are resolved, skip 2a-iii.

**2a-iii — LAST RESORT: `search_design_system`.** Only if components remain unresolved after completing both 2a-i and 2a-ii.

Before searching, call `get_libraries` to discover which libraries are available for the file. This returns two lists: libraries already added to the file and libraries available to add (community UI kits and org libraries). Each entry includes a `libraryKey` you can pass to `search_design_system` via the `includeLibraryKeys` param to scope your search to specific libraries instead of searching across everything.

```
// Step 1: Discover available libraries
get_libraries({ fileKey })
// Returns: {
//   libraries_added_to_file: [...],
//   libraries_available_to_add: [...],
//   libraries_available_to_add_next_offset: number | null
// }

// Step 2: Search within a specific library using its libraryKey
search_design_system({ queries: [{ entity: "component", query: "button" }], fileKey, includeLibraryKeys: ["lk-abc123..."] })
```

Org libraries in `libraries_available_to_add` are paginated (20 per page). When `libraries_available_to_add_next_offset` is non-null, more org libraries are available — call `get_libraries` again with `offset` set to that value to fetch the next page. Community UI kits only appear on the first page. If the user names a specific library you don't see in the current page, page further before giving up.

This is especially useful when the file has many libraries and you want targeted results (e.g. searching only within "iOS 26" or "Material 3" instead of getting matches from every library).

**Search broadly, but one intent per query** — `search_design_system` does NOT apply OR semantics, so never pack alternatives or synonyms into a single string ("Button IconButton icon" matches nothing useful). Pass each term as a component entry in one `queries` call: `{ entity: "component", query: "button" }`, `{ entity: "component", query: "input" }`, `{ entity: "component", query: "nav" }`, etc. Multi-word names and phrases are fine when they name one thing ("Material Design Icons").

**Include component properties** in your map — you need to know which TEXT properties each component exposes for text overrides. Create a temporary instance, read its `componentProperties` (and those of nested instances), then remove the temp instance.

Example component map with property info:

```
Component Map:
- Button → key: "abc123", type: COMPONENT_SET
  Properties: { "Label#2:0": TEXT, "Has Icon#4:64": BOOLEAN }
- PricingCard → key: "ghi789", type: COMPONENT_SET
  Properties: { "Device": VARIANT, "Variant": VARIANT }
  Nested "Text Heading" has: { "Text#2104:5": TEXT }
  Nested "Button" has: { "Label#2:0": TEXT }
```

#### 2b: Discover variables (colors, spacing, radii)

**Inspect existing screens first.** Reuse `variables` from the 2a-ii inventory; if that step was skipped, run the inventory here when an existing screen is available. For unresolved variables, use `search_design_system` with `queries` entries whose `entity` is `"variable"`.

> **WARNING: Two different variable discovery methods — do not confuse them.**
>
> - `use_figma` with `figma.variables.getLocalVariableCollectionsAsync()` — returns **only local variables defined in the current file**. If this returns empty, it does **not** mean no variables exist. Remote/published library variables are invisible to this API.
> - `search_design_system` with `entity: "variable"` query entries — searches across **all linked libraries**, including remote and published ones. This is the correct tool for discovering design system variables.
>
> **Never conclude "no variables exist" based solely on `getLocalVariableCollectionsAsync()` returning empty.** Always also run `search_design_system` with variable query entries to check for library variables before deciding to create your own.

**Query strategy:** `search_design_system` matches against **variable names** (e.g., "Gray/gray-9", "core/gray/100", "space/400"), not categories. Put multiple short, simple searches in one `queries` call rather than one compound query. Every array entry must be an `{ "entity": "variable", "query": "..." }` object, never a bare string:

- **Primitive colors:** `{ "entity": "variable", "query": "gray" }`, `{ "entity": "variable", "query": "red" }`, etc.
- **Semantic colors:** `{ "entity": "variable", "query": "background" }`, `{ "entity": "variable", "query": "surface" }`, etc.
- **Spacing/sizing:** `{ "entity": "variable", "query": "space" }`, `{ "entity": "variable", "query": "radius" }`, etc.

If initial searches return empty, try shorter fragments or different naming conventions — libraries vary widely ("grey" vs "gray", "spacing" vs "space", "color/bg" vs "background").

For library variables (remote = true), import them by key with `figma.variables.importVariableByKeyAsync(key)`. For local variables, use `figma.variables.getVariableByIdAsync(id)` directly.

See [variable-patterns.md](../figma-use/references/variable-patterns.md) for binding patterns.

#### 2c: Discover styles (text styles, effect styles)

Reuse `textStyles` and `effectStyles` from the inventory in 2a-ii or 2b. If no inventory exists, inspect an available screen with the same script or search with `search_design_system` using `entity: "style"` query entries and terms like "heading", "body", "shadow", "elevation". Search for any styles still missing.

Import library styles with `figma.importStyleByKeyAsync(key)`, then apply with `node.textStyleId = style.id` or `node.effectStyleId = style.id`.

See [text-style-patterns.md](../figma-use/references/text-style-patterns.md) and [effect-style-patterns.md](../figma-use/references/effect-style-patterns.md) for details.

### Step 3: Create the Wrapper Frame First

**Do NOT build sections as top-level page children and reparent them later** — moving nodes across `use_figma` calls with `appendChild()` silently fails and produces orphaned frames. Instead, create the wrapper first, then build each section directly inside it.

Create the wrapper in its own `use_figma` call. Position it away from existing content and return its ID:

```js
// Find clear space
let maxX = 0;
for (const child of figma.currentPage.children) {
  maxX = Math.max(maxX, child.x + child.width);
}

const wrapper = figma.createAutoLayout("VERTICAL");

// --- Size the wrapper based on container type ---
// Full page:       wrapper.resize(1440, 100); wrapper.name = "Homepage";
// Modal/dialog:    wrapper.resize(640, 100);  wrapper.name = "Settings Modal";
// Drawer/sidebar:  wrapper.resize(360, 100);  wrapper.name = "Navigation Drawer";
// Panel:           wrapper.resize(400, 100);  wrapper.name = "Details Panel";
// Adapt width to match the source code's actual dimensions.

wrapper.name = "VIEW_NAME";
wrapper.primaryAxisAlignItems = "CENTER";
wrapper.counterAxisAlignItems = "CENTER";
wrapper.resize(WIDTH, 100);
wrapper.layoutSizingHorizontal = "FIXED";
wrapper.x = maxX + 200;
wrapper.y = 0;

return { success: true, wrapperId: wrapper.id };
```

### Step 4: Build the Sections Inside the Wrapper

**This is the most important step.** Build in retry-safe construction phases: related sections may share one `use_figma` call when the resulting script is safe to retry. Split a phase only when it would cross page context, when partial execution would be hard to recover, or when an actual failure requires a targeted retry — not merely to create a validation checkpoint. At the start of each script, fetch the wrapper by ID and append new content directly to it.

```js
const createdNodeIds = [];

// Resolve the wrapper and import every design system dependency in parallel.
// Sequential awaits here serialize N independent IPC round-trips at the top
// of every section build; one Promise.all is dramatically faster.
const [wrapper, buttonSet, bgColorVar, spacingVar, shadowStyle] = await Promise.all([
  figma.getNodeByIdAsync("WRAPPER_ID_FROM_STEP_3"),
  figma.importComponentSetByKeyAsync("BUTTON_SET_KEY"),
  figma.variables.importVariableByKeyAsync("BG_COLOR_VAR_KEY"),
  figma.variables.importVariableByKeyAsync("SPACING_VAR_KEY"),
  figma.importStyleByKeyAsync("SHADOW_STYLE_KEY"),
]);
const primaryButton = buttonSet.children.find(c =>
  c.type === "COMPONENT" && c.name.includes("variant=primary")
) || buttonSet.defaultVariant;

// Build section frame with variable bindings (not hardcoded values)
const section = figma.createAutoLayout();
section.name = "Header";
section.setBoundVariable("paddingLeft", spacingVar);
section.setBoundVariable("paddingRight", spacingVar);
const bgPaint = figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', bgColorVar
);
section.fills = [bgPaint];

// Apply the effect style imported above
section.effectStyleId = shadowStyle.id;

// Create component instances inside the section
const btnInstance = primaryButton.createInstance();
section.appendChild(btnInstance);
createdNodeIds.push(btnInstance.id);

// Append section to wrapper
wrapper.appendChild(section);
section.layoutSizingHorizontal = "FILL"; // AFTER appending

createdNodeIds.push(section.id);
return { success: true, createdNodeIds };
```

Return the created node IDs plus the relevant counts, names, and bounds from each call — this is your default structural validation. Run a separate structural read only when that evidence is missing or when a relevant mutation has invalidated it. Save the visual pass for Step 5.

#### Override instance text with setProperties()

Component instances ship with placeholder text ("Title", "Heading", "Button"). Use the component property keys you discovered in Step 2 to override them with `setProperties()` — this is more reliable than direct `node.characters` manipulation. See [component-patterns.md](../figma-use/references/component-patterns.md#overriding-text-in-a-component-instance) for the full pattern.

For nested instances that expose their own TEXT properties, call `setProperties()` on the nested instance:

```js
// Use the type-indexed criteria for the type filter, then narrow by name.
const nestedHeading = cardInstance
  .findAllWithCriteria({ types: ["INSTANCE"] })
  .find(n => n.name === "Text Heading");
if (nestedHeading) {
  nestedHeading.setProperties({ "Text#2104:5": "Actual heading from source code" });
}
```

Only fall back to direct `node.characters` for text that is NOT managed by any component property.

#### Read source code defaults carefully

When translating code components to Figma instances, check the component's default prop values in the source code, not just what's explicitly passed. For example, `<Button size="small">Register</Button>` with no variant prop — check the component definition to find `variant = "primary"` as the default. Selecting the wrong variant (e.g., Neutral instead of Primary) produces a visually incorrect result that's easy to miss.

#### What to build manually vs. import from design system

| Build manually | Import from design system |
|----------------|--------------------------|
| Wrapper frame | **Components**: buttons, cards, inputs, nav, etc. |
| Section container frames | **Variables**: colors (fills, strokes), spacing (padding, gap), radii |
| Layout grids (rows, columns) | **Text styles**: heading, body, caption, etc. |
| | **Effect styles**: shadows, blurs, etc. |

**Never hardcode hex colors or pixel spacing** when a design system variable exists. Use `setBoundVariable` for spacing/radii and `setBoundVariableForPaint` for colors. Apply text styles with `node.textStyleId` and effect styles with `node.effectStyleId`.

#### Componentize repeated and reusable elements (required)

Componentization is part of the **default** workflow, not an optional follow-up. Produce a componentized structure on the first pass; do not emit a flat tree of one-off frames and wait for a second "now make it componentized" prompt.

- **Design-system instances are already componentized** (Step 2). Prefer them.
- **For anything the design system does not cover that repeats or maps to a reusable source component, create a local component once with `figma.createComponent()` and place instances**, instead of hand-building N near-identical frames. One source component maps to one Figma main component.

See [references/componentization.md](references/componentization.md) for the build-once-place-instances pattern and code.

#### Icons: import the SVG, never reconstruct from rotated primitives

Icons are the **main exception to the build-manually-vs-import split above.** If the design system exposes an icon as a component, instance it (a single INSTANCE_SWAP property, not a variant per icon). Otherwise — most commonly when **grabbing an icon from the codebase to place or replace it in Figma** — import the icon's **SVG source directly** as a vector node. This is the primary, default path for icons; do not redraw them.

1. **Get the SVG from the codebase.** Read the icon's source — inline `<svg>`, the imported `.svg` asset, or the icon-library entry — and pass that exact SVG string. Prefer the codebase's own SVG over hand-authoring one.
2. **Import with `figma.createNodeFromSvg(svgString)`**, which returns a `FrameNode` of editable vector paths. The SVG string **must** include a `viewBox` plus explicit `width`/`height` (e.g. `<svg width="24" height="24" viewBox="0 0 24 24" ...>`). Without `width`/`height` it falls back to the `viewBox` size, which is often smaller than the slot — the usual cause of "the icon didn't size properly."
3. **Size it to the slot.** `createNodeFromSvg` frames scale their contents on resize, so `icon.resize(size, size)` fits the whole icon (stroke weight included) to the target box. Equivalently author `width`/`height` equal to the target. Match the source's icon size — commonly 16/20/24px.
4. **Never reconstruct an icon from rotated line/rect/ellipse primitives.** Figma's line rotation is unreliable in the `use_figma` context and produces broken, mis-rotated icons (a chevron collapses into a blob, an arrowhead detaches from its shaft). Importing the SVG is both more reliable and more editable.

```js
// Place / replace an icon from a codebase SVG into a 24px slot
const icon = figma.createNodeFromSvg(
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="m9 18 6-6-6-6" stroke="#1A1A1A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
);
icon.name = "icon/chevron-right";
icon.resize(24, 24);          // scales the whole icon to the slot
slotFrame.appendChild(icon);
```

**Codebase SVGs usually use `currentColor`** (e.g. `stroke="currentColor"` / `fill="currentColor"`), which `createNodeFromSvg` imports as **black** — it does not inherit the parent's color. Set the intended color after import: substitute the literal color into the SVG string before importing, or bind the imported vector fills/strokes to a design-system color variable with `setBoundVariableForPaint` (same as any paint). To turn an imported SVG into a reusable icon component (for INSTANCE_SWAP), see [figma-generate-library → Creating Icon Components](../figma-generate-library/references/component-creation.md) and the [INSTANCE_SWAP pattern](../figma-use/references/component-patterns.md#instance_swap-avoiding-variant-explosion).

### Step 5: Validate the Full View and Transfer Images

Before visual validation, use `use_figma` to read back the wrapper and return its total descendant count, counts for every descendant node type present, and the ID, name, node type, and dimensions of every image-filled node. These counts are evidence, not a numeric pass threshold; do not infer editability from a screenshot or accept token editable nodes layered over a complete-UI raster. If a screenshot or flattened rendering of the complete UI is present anywhere inside the wrapper, remove it and rebuild the UI semantically or report failure; do not claim completion.

After composing all sections, take **one full-view composition screenshot** of the wrapper frame and compare against the source. If it reveals a meaningful visual defect, apply targeted `use_figma` fixes — don't rebuild the entire view — then take **one** post-fix screenshot. The most recent passing screenshot is the final check: do not take an additional unchanged "final" shot, and do not screenshot every section individually.

Inspect the composition screenshot for:
- **Cropped/clipped text** — line heights or frame sizing cutting off descenders, ascenders, or entire lines
- **Overlapping content** — elements stacking on top of each other due to incorrect sizing or missing auto-layout
- Placeholder text still showing ("Title", "Heading", "Button")
- Truncated content from layout sizing bugs
- Wrong component variants (e.g., Neutral vs Primary button)
- **Wrong font family** — text rendered in a different typeface than the product uses (e.g. Inter where the product is SF Pro). The script ran without error, so this is invisible at a glance; assert it explicitly (see "Assert the font family is correct" below)
- **Blank image placeholders** — if images are missing, transfer them from the `generate_figma_design` capture before considering `generate_image` to generate placeholders (see "Transfer images from the generate_figma_design capture" below)

#### Assert the font family is correct

**You MUST explicitly assert that rendered text uses the product font(s) identified in Step 1**, and treat any mismatch as a failed validation. Do not assume a successfully loaded font is the correct font: loading Inter when the product uses SF Pro is a failure even if no errors occur. **If you have a source reference (the running web app, a design mock, or the `generate_figma_design` capture), you MUST also compare rendered screenshots** — a near-miss style within the right family can pass a family check but still look wrong.

See [references/discover-product-font.md](references/discover-product-font.md#verify-the-font-after-building) for the read-back script (which separates free-standing text you fix from design-system-governed text you flag) and the screenshot-comparison steps.

#### Transfer images from the generate_figma_design capture

If you ran `generate_figma_design` in parallel, transfer only discrete content assets used by the app into your design system output. Never upload or transfer the capture root or any screenshot or flattened rendering of the complete UI.

1. Find all image nodes in the capture output by searching for fills with `type === "IMAGE"`:
   ```js
   const capture = await figma.getNodeByIdAsync("CAPTURE_NODE_ID");
   const imageNodes = capture.findAll(() => true).flatMap(n => {
     if (!Array.isArray(n.fills)) return [];
     const imageFill = n.fills.find(f => f.type === "IMAGE");
     return imageFill ? [{ name: n.name, id: n.id, imageHash: imageFill.imageHash }] : [];
   });
   return imageNodes;
   ```
2. Match each captured image to the corresponding frame in your use_figma output (by position, name, or order).
3. Apply the image hash to the target frame:
   ```js
   targetFrame.fills = [{ type: "IMAGE", imageHash: "hash_from_capture", scaleMode: "FILL" }];
   ```
4. Delete the `generate_figma_design` capture output after all images are transferred.

#### Generating placeholder images

Reuse available source, captured, or library images first. If placeholders still remain, tell the user how many images would be generated and ask permission, noting that generating images uses Figma AI credits. After consent, call `generate_image` for each placeholder, then follow its response to upload each result with `upload_assets`. Use the returned `imageHash` for the placeholder fill; finish only after the image appears.

### Step 6: Updating an Existing View

When updating rather than creating from scratch:

1. Use `get_metadata` to inspect the existing screen structure.
2. Identify which sections need updating and which can stay.
3. For each section that needs changes:
   - Locate the existing nodes by ID or name
   - Swap component instances if the design system component changed
   - Update text content, variant properties, or layout as needed
   - Remove deprecated sections
   - Add new sections
4. Follow the same evidence and screenshot cadence as Steps 4–5: rely on returned IDs plus relevant counts, names, and bounds for structural validation, then take one full-view screenshot after the updates (and one post-fix screenshot only if a targeted visual fix is needed).

```js
// Example: Swap a button variant in an existing screen.
// Batch the node lookup and component-set import in parallel — they are
// independent and awaiting them sequentially serializes two IPC round-trips.
const [existingButton, buttonSet] = await Promise.all([
  figma.getNodeByIdAsync("EXISTING_BUTTON_INSTANCE_ID"),
  figma.importComponentSetByKeyAsync("BUTTON_SET_KEY"),
]);
if (existingButton && existingButton.type === "INSTANCE") {
  const newVariant = buttonSet.children.find(c =>
    c.name.includes("variant=primary") && c.name.includes("size=lg")
  ) || buttonSet.defaultVariant;
  existingButton.swapComponent(newVariant);
}
return { success: true, mutatedNodeIds: [existingButton.id] };
```

## Reference Docs

For detailed API patterns and gotchas, load these from the [figma-use](../figma-use/SKILL.md) references as needed:

- [component-patterns.md](../figma-use/references/component-patterns.md) — importing by key, finding variants, setProperties, text overrides, working with instances
- [variable-patterns.md](../figma-use/references/variable-patterns.md) — creating/binding variables, importing library variables, scopes, aliasing, discovering existing variables
- [text-style-patterns.md](../figma-use/references/text-style-patterns.md) — creating/applying text styles, importing library text styles, type ramps
- [effect-style-patterns.md](../figma-use/references/effect-style-patterns.md) — creating/applying effect styles (shadows), importing library effect styles
- [gotchas.md](../figma-use/references/gotchas.md) — layout pitfalls (HUG/FILL interactions, counterAxisAlignItems, sizing order), paint/color issues, page context resets

## Error Recovery

Follow [figma-use error recovery](../figma-use/SKILL.md#7-error-recovery--self-correction):

- If `safeToRetryWithoutCanvasRead` is `true`, fix the error and retry.
- If `false`, read the canvas, determine what changed, then make changes.

Because this skill works in retry-safe construction phases, errors are naturally scoped to the current phase. Content from previous successful calls remains intact.

## Best Practices

- **Always search before building.** The design system likely has the component, variable, or style you need. Manual construction and hardcoded values should be the exception, not the rule.
- **Search broadly, one intent per query.** Try synonyms and partial terms as separate `{ entity, query }` entries in one `queries` call, never combined into one string — a "NavigationPill" might be found under "pill", "nav", "tab", or "chip", so pass those as four component entries. For variables, use `entity: "variable"` with queries like "color", "spacing", "radius", etc.
- **Prefer design system tokens over hardcoded values.** Use variable bindings for colors, spacing, and radii. Use text styles for typography. Use effect styles for shadows. This keeps the screen linked to the design system.
- **Prefer component instances over manual builds.** Instances stay linked to the source component and update automatically when the design system evolves.
- **Componentize by default.** Build repeated or reusable elements as a component once, then place instances. Do not ship a flat tree of one-off frames that needs a second "make it componentized" pass.
- **Work in retry-safe construction phases.** Batch related sections into one `use_figma` call when the script stays safe to retry; split only at page-context boundaries, hard-to-recover mutations, or a targeted retry after an actual failure.
- **Return node IDs and validation evidence from every call.** Return created IDs plus the relevant counts, names, and bounds — this is your default structural validation, and you'll need the IDs to compose sections and for error recovery.
- **Validate visually with one composition screenshot.** Take one full-view screenshot after composition, and one more only after a targeted visual fix; the most recent passing screenshot is final.
- **Assert the font family, not just a successful load.** A script can load the wrong font without error. After building, verify rendered text uses the product font identified in Step 1 (see Step 5).
- **Match existing conventions.** If the file already has screens, match their naming, sizing, and layout patterns.
