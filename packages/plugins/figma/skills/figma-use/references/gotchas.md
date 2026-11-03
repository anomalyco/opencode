# Gotchas & Common Mistakes

> Part of the [use_figma skill](../SKILL.md). Every known pitfall with WRONG/CORRECT code examples.

## Contents

- Component properties and variant creation pitfalls
- Paint, color, and variable binding pitfalls
- Page context and plugin lifecycle pitfalls (set current page once per `use_figma` call; split multi-page work across calls)
- Auto Layout and sizing order pitfalls (including HUG/FILL interactions, and TEXT nodes that ignore FILL and collapse to a zero-width thread)
- Variant layout and geometry pitfalls
- Canonical text-edit recipe + font loading and text/typography pitfalls
- Sequential awaits — batch independent async calls with `Promise.all` (including `import*ByKeyAsync` families)
- Prefer indexed lookups (`getNodeByIdAsync`, `findAllWithCriteria`, `node.query`) over `findAll`/`findOne` full-tree scans
- Scope traversal to the smallest known ancestor (never `figma.root.findAll`; prefer `someFrame.findAllWithCriteria` over `figma.currentPage.findAllWithCriteria`)
- Variable scopes and mode pitfalls
- Node cleanup and empty-fill pitfalls
- "no such property" errors — reading or calling members not defined on the node type
- Non-existent property writes and "object is not extensible"
- width/height are read-only — use resize()
- detachInstance() and node ID invalidation
- Icons — import the SVG, never reconstruct from rotated line primitives


## New nodes default to (0,0) and overlap existing content

Every `figma.create*()` call places the node at position (0,0). If you append multiple nodes directly to the page, they all stack on top of each other and on top of any existing content.

**This only matters for nodes appended directly to the page** (i.e., top-level nodes). Nodes appended as children of other frames, components, or auto-layout containers are positioned by their parent — don't scan for overlaps when nesting nodes.

```js
// WRONG — top-level node lands at (0,0), overlapping existing page content
const frame = figma.createFrame()
frame.name = "My New Frame"
frame.resize(400, 300)
figma.currentPage.appendChild(frame)

// CORRECT — find existing content bounds and place the new top-level node to the right
const page = figma.currentPage
let maxX = 0
for (const child of page.children) {
  const right = child.x + child.width
  if (right > maxX) maxX = right
}
const frame = figma.createFrame()
frame.name = "My New Frame"
frame.resize(400, 300)
figma.currentPage.appendChild(frame)
frame.x = maxX + 100  // 100px gap from rightmost existing content
frame.y = 0

// NOT NEEDED — child nodes inside a parent don't need overlap scanning
const card = figma.createAutoLayout('VERTICAL')
const label = figma.createText()
card.appendChild(label)  // positioned by auto-layout, no x/y needed
```

## `addComponentProperty` returns a string key, not an object — never hardcode or guess it

Figma generates the property key dynamically (e.g. `"label#4:0"`). The suffix is unpredictable. Always capture and use the return value directly.

```js
// WRONG — guessing / hardcoding the key
comp.addComponentProperty('label', 'TEXT', 'Button')
labelNode.componentPropertyReferences = { characters: 'label#0:1' }  // Error: key not found

// WRONG — treating the return value as an object
const result = comp.addComponentProperty('Label', 'TEXT', 'Button')
const propKey = Object.keys(result)[0]  // BUG: returns '0' (first char index of string!)
labelNode.componentPropertyReferences = { characters: propKey }  // Error: property '0' not found

// CORRECT — the return value IS the key string, use it directly
const propKey = comp.addComponentProperty('Label', 'TEXT', 'Button')
// propKey === "label#4:0" (exact value varies; never assume it)
labelNode.componentPropertyReferences = { characters: propKey }
```

The same applies to `COMPONENT_SET` nodes — `addComponentProperty` always returns the property key as a string.

## MUST return ALL created/mutated node IDs

Every script that creates or mutates nodes on the canvas must track and return all affected node IDs in the return value. Without these IDs, subsequent calls cannot reference, validate, or clean up those nodes.

```js
// WRONG — only returns the parent frame ID, loses track of children
const frame = figma.createFrame()
const rect = figma.createRectangle()
const text = figma.createText()
frame.appendChild(rect)
frame.appendChild(text)
return { nodeId: frame.id }

// CORRECT — returns all created node IDs in a structured response
const frame = figma.createFrame()
const rect = figma.createRectangle()
const text = figma.createText()
frame.appendChild(rect)
frame.appendChild(text)
return {
  createdNodeIds: [frame.id, rect.id, text.id],
  rootNodeId: frame.id
}

// CORRECT — when mutating existing nodes, return those IDs too
const nodes = figma.currentPage.findAll(n => n.name === 'Card')
for (const n of nodes) {
  n.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
}
return {
  mutatedNodeIds: nodes.map(n => n.id),
  count: nodes.length
}
```

## Colors are 0–1 range

```js
// WRONG — will throw validation error (ZeroToOne enforced)
node.fills = [{ type: 'SOLID', color: { r: 255, g: 0, b: 0 } }]

// CORRECT
node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
```

## Fills/strokes are immutable arrays

```js
// WRONG — modifying in place does nothing
node.fills[0].color = { r: 1, g: 0, b: 0 }

// CORRECT — clone, modify, reassign
const fills = JSON.parse(JSON.stringify(node.fills))
fills[0].color = { r: 1, g: 0, b: 0 }
node.fills = fills
```

## setBoundVariableForPaint returns a NEW paint

```js
// WRONG — ignoring return value
figma.variables.setBoundVariableForPaint(paint, "color", colorVar)
node.fills = [paint]  // paint is unchanged!

// CORRECT — capture the returned new paint
const boundPaint = figma.variables.setBoundVariableForPaint(paint, "color", colorVar)
node.fills = [boundPaint]
```

## Variable collection starts with 1 mode

```js
// A new collection already has one mode — rename it, don't try to add first
const collection = figma.variables.createVariableCollection("Colors")
// collection.modes = [{ modeId: "...", name: "Mode 1" }]
collection.renameMode(collection.modes[0].modeId, "Light")
const darkModeId = collection.addMode("Dark")
```

## combineAsVariants requires ComponentNodes

```js
// WRONG — passing frames
const f1 = figma.createFrame()
figma.combineAsVariants([f1], figma.currentPage) // Error!

// CORRECT — passing components
const c1 = figma.createComponent()
c1.name = "variant=primary, size=md"
const c2 = figma.createComponent()
c2.name = "variant=secondary, size=md"
figma.combineAsVariants([c1, c2], figma.currentPage)
```

## Page switching: sync setter does NOT work

The sync setter `figma.currentPage = page` does **NOT work** in `use_figma` — it throws `"Setting figma.currentPage is not supported"`. You **must** use `await figma.setCurrentPageAsync(page)` instead, which switches the page and loads its content.

Note: **reading** `figma.currentPage` is fine — it's only the **assignment** (`figma.currentPage = ...`) that throws.

```js
// WRONG — throws "Setting figma.currentPage is not supported"
figma.currentPage = targetPage

// CORRECT — async method switches and loads content
await figma.setCurrentPageAsync(targetPage)

// ALSO CORRECT — reading currentPage is fine
const page = figma.currentPage  // works
```

## Set current page once per `use_figma` call — split multi-page work into parallel calls

**A `use_figma` script must call `setCurrentPageAsync` at most once.** Never loop over `figma.root.children` and switch pages inside one script.

**The rule is the same for reads and writes:** if work spans multiple pages, split it into **multiple `use_figma` tool calls, one per target page, and YOU MUST issue them in parallel**.

> **Explicit instruction to the agent:** emit all N `use_figma` calls in a **single assistant message**, as N parallel tool-use blocks. Do not send them in separate turns. Do not await one before issuing the next. Each call sets `currentPage` exactly once; the harness runs them concurrently. Sequential per-page calls defeat the entire point of splitting and are slower than the in-loop pattern this rule replaces.

```js
// WRONG — one script switches pages on every iteration; reloads the file N times sequentially
const componentsByPage = {}
for (const page of figma.root.children) {
  await figma.setCurrentPageAsync(page)
  componentsByPage[page.name] = page.findAllWithCriteria({ types: ['COMPONENT'] }).map(n => n.id)
}
return componentsByPage
```

Instead, do it in two steps and parallelize step 2:

```js
// CORRECT — step 1: cheap, no page switch. Return the page IDs you'll fan out over.
return figma.root.children.map(p => ({ id: p.id, name: p.name }))
```

Then in the **next assistant turn**, emit **N parallel `use_figma` tool-use blocks in one message** — one per page. Each script runs this:

```js
// CORRECT — step 2: one call per page, currentPage set exactly once.
// The assistant issues N of these in parallel — do NOT loop pages inside the script.
const page = await figma.getNodeByIdAsync(PAGE_ID)  // PAGE_ID supplied by caller
await figma.setCurrentPageAsync(page)
// ... read or mutate this page ...
return { pageId: page.id, components: page.findAllWithCriteria({ types: ['COMPONENT'] }).map(n => n.id) }
```

This applies to discovery, mutation, component-set creation, and audits — reads and writes alike. **The only acceptable reason to switch pages multiple times in one script is when splitting would break a transactional/atomicity guarantee** (i.e., the operation must succeed across all pages or none, and a partial failure between calls would corrupt state). "It's read-only" and "I want a consistent snapshot" are *not* exceptions — fan out in parallel.

The same rule generalizes to *any* traversal: scope it to the smallest known ancestor — see [Scope traversal to the smallest known ancestor](#scope-traversal-to-the-smallest-known-ancestor).

## `get_metadata` operates on one subtree — discover pages explicitly

A Figma file can have multiple pages (canvas nodes). `get_metadata` only returns the subtree of whichever node you pass it. To get a usable index of every page:

- Call `get_metadata` with **no nodeId** — it returns the document's top-level pages as `{guid, name}` entries (no XML dump). This is the cheapest way to discover pages.
- For more detail per page (e.g. child counts, top-level node types), fall back to `use_figma`:

```js
const pages = figma.root.children.map(p => `${p.name} id=${p.id} children=${p.children.length}`);
return pages.join('\n');
```

Icons, variables, and components may live on pages other than the first. Always enumerate all pages before concluding that the file has no existing assets.

## Never use figma.notify()

```js
// WRONG — throws "not implemented" error
figma.notify("Done!")

// CORRECT — return a value to send data back to the agent
return "Done!"
```

## Prefer returned IDs for workflow state

Return node IDs and keep workflow state outside the Figma file. Put human-readable component purpose and usage in `node.description` only on a `COMPONENT` or `COMPONENT_SET`.

```js
const rect = figma.createRectangle()
return { nodeId: rect.id }
// Then pass nodeId as a string literal in the next use_figma call
```

## Script must always return a value

```js
// WRONG — no return, caller gets no useful response
figma.createRectangle()

// CORRECT — return a result (objects are auto-serialized, errors are auto-captured)
const rect = figma.createRectangle()
return { nodeId: rect.id }
```

## setBoundVariable for paint fields only works on SOLID paints

```js
// Only SOLID paint type supports color variable binding
// Gradient paints, image paints, etc. will throw
const solidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const bound = figma.variables.setBoundVariableForPaint(solidPaint, "color", colorVar)
```

## Explicit variable modes must be set per component

```js
// WRONG — all variants render with the default (first) mode
const colorCollection = figma.variables.createVariableCollection("Colors")
// ... create variables and modes ...
// Components all show the first mode's values by default!

// CORRECT — set explicit mode on each component to get variant-specific values
component.setExplicitVariableModeForCollection(colorCollection, targetModeId)
```

## `lineHeight` and `letterSpacing` must be objects, not bare numbers

```js
// WRONG — throws or silently does nothing
style.lineHeight = 1.5
style.lineHeight = 24
style.letterSpacing = 0

// CORRECT
style.lineHeight = { unit: "AUTO" }                    // auto/intrinsic
style.lineHeight = { value: 24, unit: "PIXELS" }       // fixed pixel height
style.lineHeight = { value: 150, unit: "PERCENT" }     // percentage of font size

style.letterSpacing = { value: 0, unit: "PIXELS" }     // no tracking
style.letterSpacing = { value: -0.5, unit: "PIXELS" }  // tight
style.letterSpacing = { value: 5, unit: "PERCENT" }    // percent-based
```

This applies to both `TextStyle` and `TextNode` properties. The same rule applies inside `use_figma`, interactive plugins, and any other plugin API context.

## Canonical text-edit recipe (font load → await → mutate → return IDs)

Writing to any text property on a node whose font is not yet loaded throws `Cannot write to node with unloaded font "<family> <style>"`. The fix is always the same four-step recipe — use it verbatim every time you touch text:

```js
// WRONG — font not loaded; throws Cannot write to node with unloaded font "Inter Regular"
const node = figma.createText()
node.characters = "Hello"

// CORRECT — load font, await, mutate, return affected IDs
await figma.loadFontAsync({ family: "Inter", style: "Regular" })  // any font, not just Inter — see note
const node = figma.createText()
node.characters = "Hello"
return { createdNodeIds: [node.id] }
```

**This applies to every font, not just Inter.** Inter is preloaded in most environments so the missing-`loadFontAsync` bug often only surfaces with other families (`Roboto Mono`, `Merriweather`, `Figma Hand`, library fonts, etc.). Examples in these docs use `Inter` because it's available everywhere, but the recipe is identical for any family/style pair.

**The same recipe also applies when mutating existing text** — the font already on the node, not a hardcoded default, must be loaded:

```js
// CORRECT — load the node's own current font(s), then mutate
const segments = textNode.getStyledTextSegments(['fontName'])
await Promise.all(segments.map(s => figma.loadFontAsync(s.fontName)))
textNode.characters = "Updated"
return { mutatedNodeIds: [textNode.id] }
```

Font loading is also required for **any** operation on nodes that contain unloaded fonts — `appendChild`, `insertChild`, `setBoundVariable`, `setExplicitVariableModeForCollection`, `setValueForMode`, and even `findAll` callbacks that touch text properties. If the document has existing text nodes you'll traverse, preload their fonts at the start of the script.

## Sequential awaits — batch independent async calls with `Promise.all`

Awaiting an independent async call inside a `for`/`for…of` loop — or sequentially in a straight-line block — serializes one IPC round-trip per call. Each call to `getNodeByIdAsync`, `getVariableByIdAsync`, `loadFontAsync`, `setTextStyleIdAsync`, **`importComponentByKeyAsync`, `importComponentSetByKeyAsync`, `importStyleByKeyAsync`, `importVariableByKeyAsync`**, etc. is independent — batch them with `Promise.all`. The only awaits that *must* stay sequential are `setCurrentPageAsync` (changes global page context) and explicit per-iteration dependencies.

Sequential `import*ByKeyAsync` calls at the top of a `use_figma` script are a particularly common offender — design-system scripts often import a component set plus several variables plus an effect style in a row. **Always batch the imports:**

```js
// WRONG — four sequential round-trips at the start of every section build
const buttonSet   = await figma.importComponentSetByKeyAsync("BUTTON_SET_KEY")
const bgVar       = await figma.variables.importVariableByKeyAsync("BG_COLOR_VAR_KEY")
const spacingVar  = await figma.variables.importVariableByKeyAsync("SPACING_VAR_KEY")
const shadowStyle = await figma.importStyleByKeyAsync("SHADOW_STYLE_KEY")

// CORRECT — one round-trip
const [buttonSet, bgVar, spacingVar, shadowStyle] = await Promise.all([
  figma.importComponentSetByKeyAsync("BUTTON_SET_KEY"),
  figma.variables.importVariableByKeyAsync("BG_COLOR_VAR_KEY"),
  figma.variables.importVariableByKeyAsync("SPACING_VAR_KEY"),
  figma.importStyleByKeyAsync("SHADOW_STYLE_KEY"),
])
```

```js
// WRONG — N sequential round-trips, scales linearly with list length
const vars = {}
for (const id of collection.variableIds) {
  vars[id] = await figma.variables.getVariableByIdAsync(id)
}

// CORRECT — one round-trip
const fetched = await Promise.all(
  collection.variableIds.map(id => figma.variables.getVariableByIdAsync(id))
)
const vars = {}
collection.variableIds.forEach((id, i) => { vars[id] = fetched[i] })
```

When the loop only needs the *same* font for every iteration, load it once before the loop instead of inside it. (For freshly-created `TextNode`s this is the platform default — typically Inter Regular in design files; for FigJam sticky/shape sublayers it's Inter Medium. Either way, read `node.fontName` rather than hardcoding.)

```js
// WRONG — loads the same default font on every iteration
for (const label of labels) {
  const t = figma.createText()
  await figma.loadFontAsync(t.fontName)
  t.characters = label
}

// CORRECT — load once, then mutate synchronously
const probe = figma.createText()
await figma.loadFontAsync(probe.fontName)
probe.remove()
for (const label of labels) {
  const t = figma.createText()
  t.characters = label
}
```

If you do need different fonts per node, dedupe and `Promise.all` them up-front:

```js
const uniqueFonts = [...new Map(
  textNodes.map(t => [JSON.stringify(t.fontName), t.fontName])
).values()]
await Promise.all(uniqueFonts.map(f => figma.loadFontAsync(f)))
```

## Prefer indexed lookups over `findAll` / `findOne` full-tree scans

**Rule: use `findAllWithCriteria({ types: [...] })` for type-based searches. Reserve `findOne` / `findAll(predicate)` for cases the criteria API can't express** — name patterns, regex, capability checks (`'fills' in n`), or any predicate that touches properties the engine doesn't index.

`findAll` and `findOne` walk the entire subtree node-by-node and run a JS predicate on each one. For supported criteria such as type, use the faster API in this table:

| You want… | DON'T | DO |
|---|---|---|
| One specific node, you have its ID | `page.findOne(n => n.id === id)` | `await figma.getNodeByIdAsync(id)` |
| All nodes of a given type | `page.findAll(n => n.type === 'TEXT')` | `page.findAllWithCriteria({ types: ['TEXT'] })` |
| Type + a few cheap attributes (`name`, `visible`, etc.) | `page.findAll(n => n.type === 'TEXT' && n.name === 'Title')` | `page.query('TEXT[name=Title]')` (see [SKILL.md → node.query](../SKILL.md#nodequeryselector--css-like-node-search)) |

**`types` is an array — pass multiple values in a single call instead of issuing N separate ones.** A union over `types` is OR'd.

```js
// Multiple types in one call — returns COMPONENT ∪ COMPONENT_SET in one indexed pass
page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })
```

One more rule applies to any traversal — see also the dedicated [Scope traversal to the smallest known ancestor](#scope-traversal-to-the-smallest-known-ancestor) gotcha below:

1. **Narrow the scope.** `frame.findAll(...)` is much cheaper than `figma.currentPage.findAll(...)`. Hold onto the smallest known subtree.

```js
// WRONG — full-tree scan for a single node you already have an ID for
const button = figma.currentPage.findOne(n => n.id === BUTTON_ID)

// CORRECT — indexed lookup
const button = await figma.getNodeByIdAsync(BUTTON_ID)

// WRONG — type filter via predicate (walks every node)
const textNodes = figma.currentPage.findAll(n => n.type === 'TEXT')

// CORRECT — type filter via criteria (indexed, hundreds of times faster on large docs)
const textNodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })

// WRONG — full traversal when you only need a couple of types
frame.findAll(() => true).forEach(node => { /* only touches TEXT and INSTANCE */ })

// CORRECT — restrict to the types you actually care about
const candidates = frame.findAllWithCriteria({ types: ['TEXT', 'INSTANCE'] })
for (const node of candidates) { /* ... */ }
```

**Caveat — don't enumerate every scene type just to use criteria.** If you'd need to list ~10+ types (e.g., "any node that can carry `boundVariables` or `effectStyleId`"), the type list is no longer narrowing — it's enumerating. `findAll(() => true)` is shorter, equivalently fast on real screen-sized subtrees, and saves a lot of script tokens. Reserve `findAllWithCriteria` for genuine narrowing (one to a handful of types).

**When the predicate combines type + name (or another non-indexed attribute), use criteria for the type and a `.filter`/`.find` for the rest** — the criteria stage already narrows the candidate set to the matching type using the index:

```js
// WRONG — predicate walks every node
const slot = instance.findOne(n => n.type === 'SLOT' && n.name === 'Content')

// CORRECT — type-indexed criteria + name filter
const slot = instance
  .findAllWithCriteria({ types: ['SLOT'] })
  .find(n => n.name === 'Content')
```

Name-only lookups (`findOne(n => n.name === 'X')`) cannot use criteria — they remain the right tool when you only have a name. But if you can capture the node's ID once and re-fetch with `getNodeByIdAsync` on subsequent calls, prefer that over searching by name again.

## Scope traversal to the smallest known ancestor

Every `findAll` / `findOne` / `findAllWithCriteria` walks the entire subtree of the receiver. Picking the right receiver is the single biggest performance lever you have — bigger than the type index. Cheapest to most expensive:

| Receiver | Walks… |
|---|---|
| `someFrame.findAllWithCriteria(...)` | one frame's subtree |
| `figma.currentPage.findAllWithCriteria(...)` | one page (every loaded node on it) |
| `figma.root.findAllWithCriteria(...)` | **every loaded page in the document** — only safe on tiny files |

**Rule: scope traversal to the smallest known ancestor.** If you have a specific frame's ID, search inside that frame. If you have a section, search inside that section. Drop back to `figma.currentPage` only when the work is genuinely page-wide.

```js
// WRONG — walks every loaded page in the document
const all = figma.root.findAllWithCriteria({ types: ['INSTANCE'] })

// BETTER — one page only
const onPage = figma.currentPage.findAllWithCriteria({ types: ['INSTANCE'] })

// BEST — when you have the parent frame's ID, search just that subtree
const frame = await figma.getNodeByIdAsync(FRAME_ID)
const inFrame = frame.findAllWithCriteria({ types: ['INSTANCE'] })
```

**Never use `figma.root.findAll(...)` in a `use_figma` script.** It walks every page that has been loaded into memory and forces every other page to load if not already in memory — the worst-case traversal. There is no legitimate use of it in this codebase.

**Never loop `figma.root.children` calling `setCurrentPageAsync(page)` and then `page.findAll(...)`** — that's the same antipattern in slow motion: one whole-page scan per page, plus the cost of switching pages. If work spans multiple pages, **fan out** instead: emit one `use_figma` per page in parallel (see [Set current page once per `use_figma` call](#set-current-page-once-per-use_figma-call--split-multi-page-work-into-parallel-calls)).

When you don't have a frame ID handy, capture one from a parent call and pass it to subsequent calls — `getNodeByIdAsync(id).findAllWithCriteria(...)` beats `figma.currentPage.findAllWithCriteria(...)` every time the target subtree is smaller than the page.

## Font style names are file-dependent — use `listAvailableFontsAsync` to discover them

Font style names vary per provider and per Figma file. Always call `figma.listAvailableFontsAsync()` to discover exact style strings before loading — never guess or probe with try/catch. See [text-style-patterns.md](text-style-patterns.md#discovering-available-font-styles) for the discovery + load pattern.

## combineAsVariants does NOT auto-layout in `use_figma`

```js
// WRONG — all variants stack at position (0, 0), resulting in a tiny ComponentSet
const components = [comp1, comp2, comp3]
const cs = figma.combineAsVariants(components, figma.currentPage)
// cs.width/height will be the size of a SINGLE variant!

// CORRECT — manually layout children in a grid after combining
const cs = figma.combineAsVariants(components, figma.currentPage)
const colWidth = 120
const rowHeight = 56
cs.children.forEach((child, i) => {
  const col = i % numCols
  const row = Math.floor(i / numCols)
  child.x = col * colWidth
  child.y = row * rowHeight
})
// CRITICAL: resize from actual child bounds, not formula — formula errors leave variants outside the boundary
let maxX = 0, maxY = 0
for (const child of cs.children) {
  maxX = Math.max(maxX, child.x + child.width)
  maxY = Math.max(maxY, child.y + child.height)
}
cs.resizeWithoutConstraints(maxX + 40, maxY + 40)
```

## Paint `color` must not include `a` — use `opacity` at the paint level instead

Paint `color` only accepts `{r, g, b}`. Adding `a` to it throws `"Unrecognized key(s) in object: 'a' at [0].color"`. This is a common mistake coming from CSS `rgba()` muscle memory.

Alpha/opacity belongs at the **paint level** as `opacity`, not inside `color`.

```js
// WRONG — 'a' is not valid inside color; throws validation error
node.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.1 } }]

// CORRECT — opacity goes at the paint level
node.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.1 }]

// CORRECT — fully opaque (no opacity needed)
node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
```

**COLOR variable values are the exception** — they do use `{r, g, b, a}`:

```js
// Variable values use {r, g, b, a} — this is correct for variables only
const colorVar = figma.variables.createVariable("bg", collection, "COLOR")
colorVar.setValueForMode(modeId, { r: 1, g: 0, b: 0, a: 1 })  // opaque red
colorVar.setValueForMode(modeId, { r: 0, g: 0, b: 0, a: 0 })  // fully transparent
```

## `layoutSizingHorizontal`/`layoutSizingVertical` value rules: `FIXED`, `HUG`, `FILL`

The property exists on every `SceneNode`, but the **value** you can assign depends on the node's relationship to auto-layout. The scenegraph validates the assignment (`fullscreen/lib/scenegraph/FGStackLayoutSizeHelper.cpp::checkStackLayoutSize`) and rejects non-`FIXED` values that don't satisfy a structural rule:

| Value | Allowed when | Rejected with |
| --- | --- | --- |
| `'FIXED'` | always | (never throws) |
| `'HUG'` | the node IS an auto-layout frame, OR is a **TEXT** child of an auto-layout frame | `"HUG can only be set on auto-layout frames or text children of auto-layout frames"` |
| `'FILL'` | the node is a child of an auto-layout frame, AND not absolute-positioned, AND not inside an immutable frame, AND not a canvas-grid child | `"FILL can only be set on children of auto-layout frames"`, `"FILL cannot be set on absolute positioned auto-layout children"`, `"FILL cannot be set on this node"`, `"FILL cannot be set on canvas grid children"` |
| any non-`FIXED` value on a node that is neither auto-layout nor inside auto-layout | (none — always rejected) | `"node must be an auto-layout frame or a child of an auto-layout frame"` |

**Common errors thrown** (the runtime prefixes the message with the property setter that rejected the value):

- `Error: in set_layoutSizingHorizontal: node must be an auto-layout frame or a child of an auto-layout frame`
- `Error: in set_layoutSizingHorizontal: FILL can only be set on children of auto-layout frames`

The same messages surface under `set_layoutSizingVertical` when the vertical axis is the one being set.

Practical consequences:

1. **Append first, then set.** A freshly-created node has no parent, so `child.layoutSizingHorizontal = 'FILL'` immediately after `figma.createFrame()` always throws. `appendChild` to an auto-layout parent first.
2. **The parent must actually be auto-layout.** A plain `figma.createFrame()` defaults to `layoutMode = 'NONE'` — its children cannot use `'FILL'` or `'HUG'`. Prefer `figma.createAutoLayout()` (or set the parent's `layoutMode` to `'HORIZONTAL'`/`'VERTICAL'` before appending).
3. **`'HUG'` on a non-text child of auto-layout still throws.** A `FRAME` or `RECTANGLE` child of auto-layout can be `'FILL'` or `'FIXED'` — only the auto-layout frame itself and **TEXT** children may be `'HUG'`. To make a non-text child shrink to content, set its `primaryAxisSizingMode`/`counterAxisSizingMode` to `'AUTO'` instead.
4. **`'FILL'` is incompatible with absolute positioning and canvas grids.** If you set `child.layoutPositioning = 'ABSOLUTE'`, the child no longer participates in flow and cannot be `'FILL'` — size it explicitly with `resize()` instead.

```js
// WRONG — node has no parent yet
const child = figma.createFrame()
child.layoutSizingHorizontal = 'FILL'  // "FILL can only be set on children of auto-layout frames"

// WRONG — parent is a plain frame (layoutMode === 'NONE'), not auto-layout
const parent = figma.createFrame()
parent.appendChild(child)
child.layoutSizingHorizontal = 'FILL'  // "node must be an auto-layout frame or a child of an auto-layout frame"

// WRONG — HUG on a non-text auto-layout child
const al = figma.createAutoLayout()
const rect = figma.createRectangle()
al.appendChild(rect)
rect.layoutSizingHorizontal = 'HUG'  // "HUG can only be set on auto-layout frames or text children…"

// CORRECT — auto-layout parent, appended first, then sizing
const al2 = figma.createAutoLayout()
const c = figma.createFrame()
al2.appendChild(c)
c.layoutSizingHorizontal = 'FILL'    // ok

// CORRECT — HUG on the auto-layout frame itself, or on a TEXT child
al2.layoutSizingHorizontal = 'HUG'   // ok — auto-layout frame
const t = figma.createText()
al2.appendChild(t)
t.layoutSizingHorizontal = 'HUG'     // ok — TEXT child of auto-layout
```

`figma.createAutoLayout()` returns a frame with `layoutMode` already set and both axes hugging content, so its children can immediately use `'FILL'`/`'HUG'` after being appended — preferred over `figma.createFrame()` whenever the container holds related children. See Rule 12a in [SKILL.md](../SKILL.md).

The next gotcha (`## HUG parents collapse FILL children`) layers on top of the rules above: even when assignment succeeds, a `HUG` parent gives `FILL` children no room to expand. The validation rule above is about whether the assignment is _allowed_; the next gotcha is about whether it produces useful layout.

## layoutSizing vs AxisSizingMode: two different sizing enums

`layoutSizingHorizontal`/`layoutSizingVertical` and `primaryAxisSizingMode`/`counterAxisSizingMode` look interchangeable but accept **different enums** and are set on **different nodes**. Crossing them throws a value-rejection error.

| Property family | Valid values | Set on |
| --- | --- | --- |
| `layoutSizingHorizontal` / `layoutSizingVertical` | `'FIXED'` \| `'HUG'` \| `'FILL'` | a **child** node (or the auto-layout frame itself) |
| `primaryAxisSizingMode` / `counterAxisSizingMode` | `'FIXED'` \| `'AUTO'` | the **frame** itself |

`'AUTO'` is not a valid `layoutSizing*` value — the equivalent is `'HUG'`:

```js
// WRONG
node.layoutSizingVertical = 'AUTO'   // 'AUTO' is not a layoutSizing value

// CORRECT
node.layoutSizingVertical = 'HUG'
```

`'FILL'` is not a valid `*AxisSizingMode` value — use `'FIXED'` or `'AUTO'`:

```js
// WRONG
frame.counterAxisSizingMode = 'FILL'  // throws: Expected 'FIXED' | 'AUTO', received 'FILL'

// CORRECT
frame.counterAxisSizingMode = 'FIXED'
```

`layoutSizingHorizontal/Vertical` is a shorthand that also drives `primaryAxisSizingMode`/`counterAxisSizingMode` under the hood — but the two surfaces accept different value sets, so keep their enums straight. For the structural rules on _when_ `HUG`/`FILL` are legal at all, see the section above.

## HUG parents collapse FILL children

A `HUG` parent cannot give `FILL` children meaningful size. If children have `layoutSizingHorizontal = "FILL"` but the parent is `"HUG"`, the children collapse to minimum size. The parent must be `"FILL"` or `"FIXED"` for FILL children to expand. This is a common cause of truncated text in select fields, inputs, and action rows.

```js
// WRONG — parent hugs, so FILL children get zero extra space
const parent = figma.createAutoLayout()
parent.layoutSizingHorizontal = 'HUG'
const child = figma.createFrame()
parent.appendChild(child)
child.layoutSizingHorizontal = 'FILL'  // collapses to min size!

// CORRECT — parent must be FIXED or FILL for FILL children to expand
const parent = figma.createAutoLayout()
parent.resize(400, 50)
parent.layoutSizingHorizontal = 'FIXED'  // or 'FILL' if inside another auto-layout
const child = figma.createFrame()
parent.appendChild(child)
child.layoutSizingHorizontal = 'FILL'  // expands to fill remaining 400px
```

## TEXT nodes default to `WIDTH_AND_HEIGHT` and ignore `FILL` — collapsing to a near-zero-width thread

A new `TEXT` node defaults to `textAutoResize = 'WIDTH_AND_HEIGHT'`, which makes it hug its content on **both** axes. In that mode it behaves like `HUG` and ignores `layoutSizingHorizontal = 'FILL'`: instead of filling the parent it shrinks toward minimum width, wrapping every word — or even every character — onto its own line. The result is a frame that is a few pixels wide and thousands of pixels tall (a "text thread"). Long multi-line blocks (specs, docs, descriptions) are where this bites, because the runaway height is easy to miss until you screenshot.

For a wrapping text block, set `textAutoResize = 'HEIGHT'` **and** give it an explicit width — don't rely on `FILL`. The reliable recipe is `'FIXED'` + `resize()`; then verify `node.width > 0` before moving on.

```js
// WRONG — FILL is ignored while textAutoResize is the default WIDTH_AND_HEIGHT,
// so the text hugs to ~0 width and grows to thousands of px tall
const t = figma.createText()
frame.appendChild(t)
t.layoutSizingHorizontal = 'FILL'
t.characters = longString          // wraps to one char per line → width ≈ 0, height ≈ 348114

// CORRECT — switch to HEIGHT autoresize and set an explicit width, then verify
const t = figma.createText()
frame.appendChild(t)
t.textAutoResize = 'HEIGHT'                 // grow vertically, wrap at a fixed width
t.layoutSizingHorizontal = 'FIXED'
t.resize(852, t.height)                     // e.g. parent 900 − 24*2 padding
t.characters = longString
if (t.width === 0) throw new Error('text collapsed — width not applied')
```

Set `textAutoResize = 'HEIGHT'` (or `'NONE'`) **before** sizing or assigning `characters`. `FILL` on a TEXT child only works once the node is in `HEIGHT`/`NONE` mode and the auto-layout parent has a committed fixed counter-axis width — when in doubt, prefer explicit `'FIXED'` + `resize()`.

## `layoutGrow` with a hugging parent causes content compression

```js
// WRONG — layoutGrow on a child when parent has primaryAxisSizingMode='AUTO' (hug)
// causes the child to SHRINK below its natural size instead of expanding
const parent = figma.createComponent()
parent.layoutMode = 'VERTICAL'
parent.primaryAxisSizingMode = 'AUTO'  // hug contents
const content = figma.createAutoLayout('VERTICAL')
parent.appendChild(content)
content.layoutGrow = 1  // BUG: content compresses, children hidden!

// CORRECT — only use layoutGrow when parent has FIXED sizing with extra space
content.layoutGrow = 0  // let content take its natural size
// OR: set parent to FIXED sizing first
parent.primaryAxisSizingMode = 'FIXED'
parent.resizeWithoutConstraints(300, 500)
content.layoutGrow = 1  // NOW it correctly fills remaining space
```

## `width` and `height` are read-only — use `resize()`

`node.width` and `node.height` are read-only. Assigning to them throws `"TypeError: no setter for property"`. Use `resize()` or `resizeWithoutConstraints()` instead.

Note: `x` and `y` are **not** read-only and can be set directly.

```js
// WRONG — throws "no setter for property"
node.width = 300
node.height = 64

// CORRECT — use resize() to change dimensions
node.resize(300, 64)           // change both
node.resize(300, node.height)  // change width only
node.resize(node.width, 64)    // change height only

// CORRECT — x and y are writable directly
node.x = 100
node.y = 200
```

For sections and component sets, use `resizeWithoutConstraints()` instead of `resize()` (see the sections gotcha above).

## `resize()` resets `primaryAxisSizingMode` and `counterAxisSizingMode` to FIXED

`resize(w, h)` silently resets **both** sizing modes to `FIXED`. If you call it after setting `HUG`, the frame locks to the exact pixel value you passed — even a throwaway like `1`.

```js
// WRONG — resize() after setting sizing mode overwrites it back to FIXED
const frame = figma.createComponent()
frame.layoutMode = 'VERTICAL'
frame.primaryAxisSizingMode = 'AUTO'  // hug height
frame.counterAxisSizingMode = 'FIXED'
frame.resize(300, 10)  // BUG: resets BOTH axes to 'FIXED'! Height stays at 10px forever.

// ESPECIALLY DANGEROUS — throwaway values when you only care about one axis
const comp = figma.createComponent()
comp.layoutMode = 'VERTICAL'
comp.layoutSizingHorizontal = 'FIXED'
comp.layoutSizingVertical = 'HUG'
comp.resize(280, 1)  // BUG: "I only want width=280" but this locks height to 1px!
// HUG was reset to FIXED by resize(), frame is now permanently 280×1

// CORRECT — call resize() FIRST, then set sizing modes
const frame = figma.createComponent()
frame.layoutMode = 'VERTICAL'
frame.resize(300, 40)  // use a reasonable default, never 0 or 1
frame.counterAxisSizingMode = 'FIXED'  // keep width fixed at 300
frame.primaryAxisSizingMode = 'AUTO'   // NOW set height to hug — this sticks!
// Or use the modern shorthand (equivalent):
// frame.layoutSizingHorizontal = 'FIXED'
// frame.layoutSizingVertical = 'HUG'
```

**Rule of thumb**: Never pass a throwaway/garbage value (like `1` or `0`) to `resize()` for an axis you intend to be `HUG`. Either call `resize()` before setting sizing modes, or use a reasonable default that won't cause visual bugs if the mode reset goes unnoticed.

## Node positions don't auto-reset after reparenting

```js
// WRONG — assuming positions reset when moving a node into a new parent
const node = figma.createRectangle()
node.x = 500; node.y = 500;
figma.currentPage.appendChild(node)
section.appendChild(node)  // node still at (500, 500) relative to section!

// CORRECT — explicitly set x/y after ANY reparenting operation
section.appendChild(node)
node.x = 80; node.y = 80;  // reset to desired position within section
```

## Grid layout with mixed-width rows causes overlaps

```js
// WRONG — using a single column offset for rows with different-width items
// e.g. vertical cards (320px) and horizontal cards (500px) in a 2-row grid
for (let i = 0; i < allCards.length; i++) {
  allCards[i].x = (i % 4) * 370  // 370 works for 320px cards but NOT 500px cards!
}

// CORRECT — compute each row's spacing independently based on actual child widths
const gap = 50
let x = 0
for (const card of horizontalCards) {
  card.x = x
  x += card.width + gap  // use actual width, not a fixed column size
}
```

## Sections don't auto-resize to fit content

```js
// WRONG — section stays at default size, content overflows
const section = figma.createSection()
section.name = "My Section"
section.appendChild(someNode) // node may be outside section bounds

// CORRECT — explicitly resize after adding content
const section = figma.createSection()
section.name = "My Section"
section.appendChild(someNode)
section.resize(
  Math.max(someNode.width + 100, 800),
  Math.max(someNode.height + 100, 600)
)
```

## `counterAxisAlignItems` does NOT support `'STRETCH'`

```js
// WRONG — 'STRETCH' is not a valid enum value
comp.counterAxisAlignItems = 'STRETCH'
// Error: Invalid enum value. Expected 'MIN' | 'MAX' | 'CENTER' | 'BASELINE', received 'STRETCH'

// CORRECT — use 'MIN' on the parent, then set children to FILL on the cross axis
comp.counterAxisAlignItems = 'MIN'
comp.appendChild(child)
// For vertical layout, stretch width:
child.layoutSizingHorizontal = 'FILL'
// For horizontal layout, stretch height:
child.layoutSizingVertical = 'FILL'
```

## Variable collection mode limits are plan-dependent

```js
// Figma limits modes per collection based on the team/org plan:
//   Free: 1 mode only (no addMode)
//   Professional: up to 4 modes
//   Organization/Enterprise: up to 40+ modes
//
// WRONG — creating 20 modes on a Professional plan will fail silently or throw
const coll = figma.variables.createVariableCollection("Variants")
for (let i = 0; i < 20; i++) coll.addMode("mode" + i) // May fail!

// CORRECT — if you need many modes, split across multiple collections
// E.g., instead of 1 collection with 20 modes (variant×color):
//   Collection A: 4 modes (variant: plain/outlined/soft/solid)
//   Collection B: 5 modes (color: neutral/primary/danger/success/warning)
// Then use setExplicitVariableModeForCollection for BOTH on each component
```

## Variables default to `ALL_SCOPES` — always set scopes explicitly

```js
// WRONG — variable appears in every property picker (fills, text, strokes, spacing, etc.)
const bgColor = figma.variables.createVariable("Background/Default", coll, "COLOR")
// bgColor.scopes defaults to ["ALL_SCOPES"] — pollutes all dropdowns

// CORRECT — restrict to relevant property pickers
const bgColor = figma.variables.createVariable("Background/Default", coll, "COLOR")
bgColor.scopes = ["FRAME_FILL", "SHAPE_FILL"]  // fill pickers only

const textColor = figma.variables.createVariable("Text/Default", coll, "COLOR")
textColor.scopes = ["TEXT_FILL"]  // text color picker only

const borderColor = figma.variables.createVariable("Border/Default", coll, "COLOR")
borderColor.scopes = ["STROKE_COLOR"]  // stroke picker only

const spacing = figma.variables.createVariable("Space/400", coll, "FLOAT")
spacing.scopes = ["GAP"]  // gap/spacing pickers only

// Hide primitives that are only referenced via aliases
const primitive = figma.variables.createVariable("Brand/500", coll, "COLOR")
primitive.scopes = []  // hidden from all pickers
```

## Binding fills on nodes with empty fills

```js
// WRONG — binding to a node with no fills does nothing
const comp = figma.createComponent()
comp.fills = [] // transparent
// Can't bind a color variable to fills that don't exist

// CORRECT — add a placeholder SOLID fill, then bind the variable
const comp = figma.createComponent()
const basePaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const boundPaint = figma.variables.setBoundVariableForPaint(basePaint, "color", colorVar)
comp.fills = [boundPaint]
// The variable's resolved value (which may be transparent) will control the actual color
```

## Mode names must be descriptive — never leave 'Mode 1'

Every new `VariableCollection` starts with one mode named `'Mode 1'`. Always rename it immediately. For single-mode collections use `'Default'`; for multi-mode collections use names from the source (e.g. `'Light'`/`'Dark'`, `'Desktop'`/`'Tablet'`/`'Mobile'`).

    // WRONG — generic names give no semantic meaning
    const coll = figma.variables.createVariableCollection('Colors')
    // coll.modes[0].name === 'Mode 1' — left as-is
    const darkId = coll.addMode('Mode 2')

    // CORRECT — rename immediately to match the source
    const coll = figma.variables.createVariableCollection('Colors')
    coll.renameMode(coll.modes[0].modeId, 'Light')   // was 'Mode 1'
    const darkId = coll.addMode('Dark')

    // For single-mode collections (primitives, spacing, etc.)
    const spacing = figma.variables.createVariableCollection('Spacing')
    spacing.renameMode(spacing.modes[0].modeId, 'Default')  // was 'Mode 1'

## CSS variable names must not contain spaces

When constructing a `var(--name)` string from a Figma variable name, replace BOTH slashes AND spaces with hyphens and convert to lowercase.

    // WRONG — only replacing slashes leaves spaces like 'var(--color-bg-brand secondary hover)'
    v.setVariableCodeSyntax('WEB', `var(--${figmaName.replace(/\//g, '-').toLowerCase()})`)

    // CORRECT — replace all whitespace and slashes in one pass
    v.setVariableCodeSyntax('WEB', `var(--${figmaName.replace(/[\s\/]+/g, '-').toLowerCase()})`)

**Best practice**: Preserve the original CSS variable name from the source token file rather than deriving it from the Figma name.

    // Preferred — use the source CSS name directly
    v.setVariableCodeSyntax('WEB', `var(${token.cssVar})`)  // e.g. '--color-bg-brand-secondary-hover'

## "no such property" errors — reading or calling members not defined on the node type

Every Figma node implements a specific set of mixins. In `use_figma`, reading or calling a non-softened property/method that isn't on the target throws `TypeError: node.X: no such property 'X' on Y node` (where `Y` is the runtime type — `TEXT`, `RECTANGLE`, `GROUP`, `PAGE`, `VECTOR`, …). Some commonly probed missing properties return `undefined`, but unsupported writes still throw. The same error fires for hallucinated API names that don't exist anywhere (e.g. `getRangeAllFontNames` — the real APIs are `getStyledTextSegments(['fontName'])` and `getRangeFontName(start, end)`).

Common shapes the bug takes — what you tried vs. where the member actually lives:
| Member | Defined on | Notably absent from |
| --- | --- | --- |
| `children`, `appendChild`, `insertChild`, `findAll`, `findOne`, `findChildren`, `findChild`, `findAllWithCriteria` | `ChildrenMixin` — container nodes (`Document`, `Page`, `Frame`, `Group`, `Component`, `ComponentSet`, `Instance`, `Section`, `BooleanOperation`) | `TEXT`, `RECTANGLE`, `VECTOR`, `ELLIPSE`, `LINE`, `STAR`, `POLYGON`, `SLICE` |
| `layoutMode`, `itemSpacing`, padding/axis-alignment (`primaryAxisAlignItems`, `counterAxisAlignItems`, `counterAxisSpacing`, `counterAxisAlignContent`, `layoutWrap`, `primaryAxisSizingMode`) | `BaseFrameMixin` / `AutoLayoutMixin` — `FRAME`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE` only | `TEXT`, shapes, vectors, `GROUP`, `SECTION` |
| `fills`, `strokes`, `strokeWeight` | `GeometryMixin`/`MinimalFillsMixin` — shapes, frames, components, text, sections | `GROUP` (groups are pass-through), `PAGE`, `DOCUMENT` |
| `x`, `y`, `width`, `height`, `rotation`, `resize()` | `LayoutMixin` — every `SceneNode` | `PAGE`, `DOCUMENT` |
| `characters`, `fontName`, `fontSize`, `getStyledTextSegments`, `getRangeFontName`, `setRangeFontName`, `setRangeFontSize` | text-capable nodes (`TEXT`, `TEXT_PATH`, and text sublayers reached through `.text`) | frames, instances, and other non-text nodes |
| `description` | `COMPONENT` and `COMPONENT_SET` scene nodes | every other scene-node type; missing reads return `undefined` in `use_figma`, but writes throw |
| `createInstance` | `COMPONENT` only | every other type |
| `addComponentProperty`, `componentPropertyDefinitions` | `COMPONENT_SET`, or a non-variant `COMPONENT` (one whose parent is NOT a `COMPONENT_SET`) | every other type, **including variant `COMPONENT`s** — invoking on a variant throws `"Can only get/set component property definitions of a component set or non-variant component"`. Add properties on the variant before `combineAsVariants`, or on the parent `COMPONENT_SET` after. |
| `defaultVariant`, `variantGroupProperties` | `COMPONENT_SET` only | every other type |
| `figma.createPage` | Design files only (`figma.com/design/...`) | FigJam (`/board/`) and Slides (`/slides/`) — see Page Rules |

Verify any member you're unsure about against [plugin-api-standalone.d.ts](plugin-api-standalone.d.ts) before using it. Names that "sound plausible" but aren't in the typings will always throw — the typings are the source of truth.
For `componentPropertyDefinitions`, checking only `node.type === 'COMPONENT'` is insufficient because variants have that type too. Resolve the owner first: keep a `COMPONENT_SET`, promote a variant `COMPONENT` to its parent set, keep a non-variant `COMPONENT`, and reject every other node type. See [component-patterns.md → Component-property owner narrowing](component-patterns.md#component-property-owner-narrowing) for the owner-narrowing rule.
**Optional chaining (`?.`) does NOT defend against this.** The property access happens before `?.` is evaluated, so `node.children?.length` still throws on a `TEXT` node. The same applies to `try { node.fills }` — the access throws inside the try, which works for catching, but you should narrow up front instead.

**How to avoid:**

1. **Narrow by `node.type` before accessing type-specific surface.** `if (node.type === 'TEXT') node.getStyledTextSegments(...)`. This is the most explicit form and gives correctly-typed access in editors/typecheckers.
2. **For mixin-shaped traversal, use the `in` operator.** `if ("children" in node) for (const c of node.children) ...` — the right pattern for polymorphic helpers and generic recursion where the specific node type doesn't matter.
3. **Prefilter when possible.** `findAllWithCriteria({ types: ['TEXT'] })` returns an already-narrowed array, eliminating the need for per-iteration guards.

## Setting a non-existent property throws "object is not extensible"

Figma plugin API node objects are non-extensible — you cannot add new properties to them. Setting a property name that doesn't exist on a node type throws `"Cannot add property X, object is not extensible"` (surfaced as `"object is not extensible"`). This only fires on **write**, and only for properties not defined on that node type.

```js
// WRONG — 'strokeDashes' does not exist on VectorNode; throws "object is not extensible"
const v = figma.createVector()
v.strokeDashes = [4, 8]  // Error!

// CORRECT — the actual property is dashPattern
v.dashPattern = [4, 8]

// WRONG — any invented property name throws the same error
node.customColor = '#ff0000'  // Error — not a real API property
```

**How to avoid this**: Before setting any property, verify it exists on the node type by grepping [plugin-api-standalone.d.ts](plugin-api-standalone.d.ts). Property names that sound plausible but aren't in the typings will always throw.

## `detachInstance()` invalidates ancestor node IDs

When `detachInstance()` is called on a nested instance inside a library component instance, the parent instance may also get implicitly detached (converted from INSTANCE to FRAME with a **new ID**). Any previously cached ID for the parent becomes invalid.

```js
// WRONG — using cached parent ID after child detach
const parentId = parentInstance.id;
nestedChild.detachInstance();
const parent = await figma.getNodeByIdAsync(parentId); // null! ID changed.

// CORRECT — re-discover by traversal from a stable (non-instance) frame
const stableFrame = await figma.getNodeByIdAsync(manualFrameId);
nestedChild.detachInstance();
const parent = stableFrame.findOne(n => n.name === "ParentName");
```

If detaching multiple nested instances across siblings, do it in a **single** `use_figma` call — discover all targets by traversal before any detachment mutates the tree.

## Icons: import the SVG — never reconstruct from rotated line primitives

Rebuilding an icon out of individual `createLine()` / rectangle / ellipse primitives and rotating them is **unreliable in the `use_figma` context** — `node.rotation` pivots around the node's origin (not its center), so rotated segments drift out of place and the rendered icon comes out broken (a chevron collapses into a blob, an arrowhead detaches from its shaft). Always import the icon's SVG instead — it is both reliable and editable.

```js
// WRONG — reconstruct from rotated lines; rotation is unreliable, icon renders broken
const shaft = figma.createLine(); shaft.resize(30, 0); shaft.rotation = 90;
const barbL = figma.createLine(); barbL.resize(14, 0); barbL.rotation = 45;
const barbR = figma.createLine(); barbR.resize(14, 0); barbR.rotation = 135;

// CORRECT — import the SVG; createNodeFromSvg returns an editable FrameNode at the SVG's size
const icon = figma.createNodeFromSvg(
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M12 5v14M19 12l-7 7-7-7" stroke="#1A1A1A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
);
icon.resize(24, 24); // scales the whole icon — createNodeFromSvg children carry SCALE constraints
```

**Sizing:** the SVG string must include a `viewBox` plus explicit `width`/`height`. Without `width`/`height` the node falls back to the `viewBox` size, which is often smaller than the slot and reads as "the icon didn't size properly." To fit an icon to a target box, set the SVG's `width`/`height` to the target or call `icon.resize(size, size)` after import. See [figma-generate-design](../../figma-generate-design/SKILL.md) for the screen-building icon workflow.
