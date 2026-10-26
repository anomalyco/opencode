---
name: figma-use
description: "**MANDATORY prerequisite** — you MUST invoke this skill BEFORE every `use_figma` tool call. NEVER call `use_figma` directly without loading this skill first. Skipping it causes common, hard-to-debug failures. Trigger whenever the user wants to perform a write action or a unique read action that requires JavaScript execution in the Figma file context — e.g. create/edit/delete nodes, set up variables or tokens, build components and variants, modify auto-layout or fills, bind variables to properties, or inspect file structure programmatically."
disable-model-invocation: false
---

# use_figma — Figma Plugin API Skill

Use the `use_figma` tool to execute JavaScript in Figma files via the Plugin API. All detailed reference docs live in `references/`.

**Always include `figma-use` in the comma-separated `skillNames` parameter when calling `use_figma`. If this skill was loaded via an MCP resource, you MUST prefix the name with `resource:` (e.g. `resource:figma-use`).** This is a logging parameter used to track skill usage — it does not affect execution.

**If Figma MCP tools appear as deferred tools, batch-load all their schemas in a single `ToolSearch` call** using the `select:` syntax — e.g. `ToolSearch query="select:use_figma,get_screenshot,get_metadata,create_new_file"`. One round trip beats six.

**If the task involves building or updating a full page, screen, or multi-section layout in Figma from code**, also load [figma-generate-design](../figma-generate-design/SKILL.md). It provides the workflow for discovering design system components via `search_design_system`, importing them, and assembling screens incrementally. Both skills work together: this one for the API rules, that one for the screen-building workflow.

**If the task involves creating or building a component in Figma** (even a single component), also load [figma-generate-library](../figma-generate-library/SKILL.md). It provides the component creation workflow — variable foundations, variant sets, design token bindings — that `figma-use` alone doesn't cover.

Before anything, load [plugin-api-standalone.index.md](references/plugin-api-standalone.index.md) to understand what is possible. When you are asked to write plugin API code, use this context to grep [plugin-api-standalone.d.ts](references/plugin-api-standalone.d.ts) for relevant types, methods, and properties. This is the definitive source of truth for the API surface. It is a large typings file, so do not load it all at once, grep for relevant sections as needed.

IMPORTANT: Whenever you work with design systems, start with [working-with-design-systems/wwds.md](references/working-with-design-systems/wwds.md) to understand the key concepts, processes, and guidelines for working with design systems in Figma. Then load the more specific references for components, variables, text styles, and effect styles as needed.

## 1. Critical Rules
1.  **Use `return` to send data back.** The return value is JSON-serialized automatically (objects, arrays, strings, numbers). Do NOT call `figma.closePlugin()` or wrap code in an async IIFE — this is handled for you.
2.  **Write plain JavaScript with top-level `await` and `return`.** Code is automatically wrapped in an async context. Do NOT wrap in `(async () => { ... })()`.
3.  `figma.notify()` **throws "not implemented"** — never use it
3a. **Return node IDs and keep workflow state outside the Figma file.** Set human-readable component purpose and usage in `node.description` only on a `COMPONENT` or `COMPONENT_SET` — never on a frame or instance.
3b. **Narrow before accessing type-specific properties.** Check `node.type`, use a capability guard such as `"characters" in node`, or prefilter with `findAllWithCriteria`. `characters` requires a text-capable node; optional chaining does not protect unsupported property access.
4.  `console.log()` is NOT returned — use `return` for output
5.  **Size construction calls for safe retry and validate from evidence.** Do not split a working operation solely to create validation checkpoints. Batch related work when the resulting script remains safe to retry; a complete section or page may be built in one call. Split when crossing page context, when partial execution would be difficult to recover, or after an actual failure requires a targeted retry. Return affected IDs and relevant counts, names, or bounds from each write—this counts as structural validation. Run a separate structural check only when required evidence is missing or after a relevant mutation. Normally take one screenshot after composition and one after a visual fix. The most recent passing screenshot is the final check; do not repeat it when nothing relevant changed. Stop once requirements pass.
6.  Colors are **0–1 range** (not 0–255): `{r: 1, g: 0, b: 0}` = red. Paint `color` objects use `{r, g, b}` **only — no `a` field**; opacity goes at the paint level (`{ type: 'SOLID', color: {...}, opacity: 0.5 }`).
7.  Fills/strokes are **read-only arrays** — clone, modify, reassign
8.  **Every text edit follows the canonical recipe: load font → `await` → mutate → return affected node IDs.** Skipping the load throws `Cannot write to node with unloaded font "<family> <style>"`. The rule covers more than `characters` — it applies to any operation on nodes with unloaded fonts (`appendChild`, `insertChild`, `setBoundVariable`, `setExplicitVariableModeForCollection`, `setValueForMode`, `findAll` callbacks touching text). When mutating existing text, load the node's *current* fonts via `getStyledTextSegments(['fontName'])`, not a hardcoded default. Inter is preloaded in most environments so other families surface this bug more often — the recipe is the same for every font. Use `await figma.listAvailableFontsAsync()` first if the style string is unverified — **never guess** (`"SemiBold"` vs `"Semi Bold"` is a common footgun). For `FONT_FAMILY`-scoped variables, load every value across every relevant mode before `setBoundVariable("fontFamily", …)`, `setValueForMode`, or `setExplicitVariableModeForCollection`. `lineHeight`/`letterSpacing` take `{unit, value}`, not bare numbers. See [Canonical text-edit recipe](references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids).
9.  **Pages load incrementally** — use `await figma.setCurrentPageAsync(page)` to switch pages and load their content. The sync setter `figma.currentPage = page` does **NOT** work and throws `"Setting figma.currentPage is not supported"`. Page context resets to the **first page** at the start of every `use_figma` call, so re-switch each call; switch **at most once per call** and fan multi-page work out in parallel — see [Page Rules](#2-page-rules-critical) and [gotchas.md](references/gotchas.md#set-current-page-once-per-use_figma-call--split-multi-page-work-into-parallel-calls).
10. `setBoundVariableForPaint` returns a **NEW** paint — must capture and reassign
11. `createVariable` accepts collection **object or ID string** (object preferred)
12. **`layoutSizingHorizontal/Vertical` is value-restricted by structural context — `FIXED` always works, `HUG` and `FILL` do not.** `'HUG'` is valid only on an auto-layout frame itself OR on a **TEXT** child of one. `'FILL'` is valid only on a child of an auto-layout frame that is also not absolute-positioned, not inside an immutable frame, and not a canvas-grid child. Practical consequence: append to an auto-layout parent FIRST, then set `HUG`/`FILL` — a newly-created or unparented node can't satisfy the rule yet. The property itself exists on every `SceneNode`; the error is value-rejection, not "no such property". See [Gotchas](references/gotchas.md#layoutsizinghorizontallayoutsizingvertical-value-rules-fixed-hug-fill).
12a. **Use auto-layout for containers that hold related children.** When children have a structural relationship — stacked, side-by-side, aligned, gapped, hugged — wrap them in `figma.createAutoLayout()`, not `figma.createFrame()` with absolute `x`/`y`. Absolute coordinates govern where a container sits on the canvas; auto-layout governs how its children relate inside it. Skipping the container leaves no protection against text reflow, content changes, or overlap.
12b. **`layoutSizing*` and `*AxisSizingMode` are different enums — don't cross them.** `layoutSizingHorizontal`/`layoutSizingVertical` (set on a **child**) take `'FIXED'|'HUG'|'FILL'`; `primaryAxisSizingMode`/`counterAxisSizingMode` (set on the **frame** itself) take `'FIXED'|'AUTO'`. So `layoutSizingVertical = 'AUTO'` is invalid (use `'HUG'`), and `counterAxisSizingMode = 'FILL'` throws `Expected 'FIXED' | 'AUTO', received 'FILL'` (use `'FIXED'`/`'AUTO'`). Two more errors from the same setter — `Error: in set_layoutSizingHorizontal: node must be an auto-layout frame or a child of an auto-layout frame` and `Error: in set_layoutSizingHorizontal: FILL can only be set on children of auto-layout frames` — mean the node isn't in an auto-layout context yet; **recommendation: make the parent auto-layout (`figma.createAutoLayout()`) and `appendChild` the node before setting** (see Rule 12). See [Gotchas](references/gotchas.md#layoutsizing-vs-axissizingmode-two-different-sizing-enums).
12c. **`resize()` resets sizing modes to `FIXED`, so call it BEFORE setting `layoutSizing*`.** A wrapping **TEXT** block needs `textAutoResize = 'HEIGHT'` plus an explicit FIXED width (`resize()`), NOT `FILL` alone — the default `WIDTH_AND_HEIGHT` mode ignores `FILL` and collapses the node to a near-zero-width thread. Verify `node.width > 0` afterward.
13. **Position new top-level nodes away from (0,0).** Nodes appended directly to the page default to (0,0). Scan `figma.currentPage.children` to find a clear position (e.g., to the right of the rightmost node). This only applies to page-level nodes — nodes nested inside other frames or auto-layout containers are positioned by their parent. See [Gotchas](references/gotchas.md).
14. **On `use_figma` error, obey `safeToRetryWithoutCanvasRead`.** If `true`, fix the error and retry. If `false`, read the canvas, determine what changed, then make changes. See [Error Recovery](#7-error-recovery--self-correction).
15. **MUST `return` ALL created/mutated node IDs.** Whenever a script creates new nodes or mutates existing ones on the canvas, collect every affected node ID and return them in a structured object (e.g. `return { createdNodeIds: [...], mutatedNodeIds: [...] }`). This is essential for subsequent calls to reference, validate, or clean up those nodes. No state persists across `use_figma` calls, so pass IDs from previous calls as **string literals**, not variables. See [common-patterns.md](references/common-patterns.md) for worked multi-step examples.
16. **Always set `variable.scopes` explicitly when creating variables.** The default `ALL_SCOPES` pollutes every property picker — almost never what you want. Use specific scopes like `["FRAME_FILL", "SHAPE_FILL"]` for backgrounds, `["TEXT_FILL"]` for text colors, `["GAP"]` for spacing, etc. See [variable-patterns.md](references/variable-patterns.md) for the full list.
17. **`await` every Promise.** Never leave a Promise unawaited — unawaited async calls (e.g. `figma.loadFontAsync(...)` without `await`, or `figma.setCurrentPageAsync(page)` without `await`) will fire-and-forget, causing silent failures or race conditions. The script may return before the async operation completes, leading to missing data or half-applied changes.
18. **Never read `componentPropertyDefinitions` from a variant component.** Narrow the owner first: use the node itself when it is a `COMPONENT_SET`, use a `COMPONENT` only when its parent is not a `COMPONENT_SET`, and otherwise promote a variant `COMPONENT` to its parent set. Optional chaining does not make the getter safe. See [Component-property owner narrowing](references/component-patterns.md#component-property-owner-narrowing).
> For detailed WRONG/CORRECT examples of each rule, see [Gotchas & Common Mistakes](references/gotchas.md).

## 2. Page Rules (Critical)

The async-only setter and the per-call context reset are covered in Rule 9. This section elaborates the one rule that needs a worked example: **switch pages at most once per script, and fan multi-page work out in parallel.**

Never loop over `figma.root.children` and switch pages inside the loop — each switch reloads the file. If the work spans multiple pages, **split it into N `use_figma` calls (one per target page) and emit them in parallel** — a single assistant message containing N `use_figma` tool-use blocks. The harness runs them concurrently; each script sets `currentPage` exactly once.

> **Explicit instruction:** when fanning out, you MUST issue the N tool calls in **one message**. Do not send them across multiple turns. Do not await one before issuing the next. Sequential per-page calls waste the entire benefit of splitting.

```js
// AVOID — switches pages N times in one script, reloads the file each time
for (const page of figma.root.children) {
  await figma.setCurrentPageAsync(page);
  // ... touch this page ...
}

// PREFER — read-only discovery call to get page IDs, then in the NEXT message
// emit N parallel use_figma tool calls (one per page), each setting currentPage once.
```

Default to parallel fan-out for any multi-page work — reads and writes alike. You can also call `use_figma` multiple times to build incrementally (e.g. `return` metadata about existing nodes, then modify them in a subsequent script). See [gotchas.md → Set current page once per `use_figma` call](references/gotchas.md#set-current-page-once-per-use_figma-call--split-multi-page-work-into-parallel-calls) for the full rationale.

## 3. `return` Is Your Output Channel

The agent sees **ONLY** the value you `return` — `console.log()` is invisible (Rule 4), and thrown errors are auto-captured (let them propagate or `throw` explicitly). The hard requirement is Rule 15: every script that creates or mutates canvas nodes **MUST** return all affected node IDs plus any actionable status in a structured object — e.g. `return { createdNodeIds: [...], mutatedNodeIds: [...], count: 5, errors: [] }` — so subsequent calls can reference, validate, or clean them up.

## 4. Editor Mode

`use_figma` works in **design mode** (editorType `"figma"`, the default). FigJam (`"figjam"`) and Slides (`"slides"`) have different sets of available node types — most design nodes are blocked in FigJam, and FigJam-only nodes are blocked in Slides.

**Tell the editor from the URL:** Design = `figma.com/design/...`, FigJam = `figma.com/board/...`, Slides = `figma.com/slides/...`. Confirm before assuming an API is available.

Available in design mode: Rectangle, Frame, Component, Text, Ellipse, Star, Line, Vector, Polygon, BooleanOperation, Slice, Page, Section, TextPath.

**Blocked** in design mode: Sticky, Connector, ShapeWithText, CodeBlock, Slide, SlideRow, SlideGrid, InteractiveSlideElement, Webpage.

Available in Slides mode: Rectangle, Frame, Component, Text, Ellipse, Star, Line, Vector, Polygon, BooleanOperation, Slice, Section, TextPath, Slide, SlideRow, SlideGrid, InteractiveSlideElement.

**Blocked** in Slides mode: Sticky, Connector, ShapeWithText, CodeBlock, Webpage, Page.

**Design-only APIs (not just node types):** `figma.createPage()` is available only in Design files (`figma.com/design/...`). In both FigJam (`figma.com/board/...`) and Slides (`figma.com/slides/...`) it throws `TypeError: figma.createPage no such property 'createPage' on the figma global object`. Do not emit `figma.createPage()` in FigJam or Slides workflows.

> **Slides note:** There is no dedicated read tool for Slides files yet. Use `use_figma` with read-only scripts for inspection (see Section 6 "Inspect first" pattern), and `get_screenshot` / `await node.screenshot()` for visual context. For Slides-specific API guidance, load the [figma-use-slides](../figma-use-slides/SKILL.md) skill.

## 5. Efficient APIs — Prefer These Over Verbose Alternatives

These APIs reduce boilerplate, eliminate ordering errors, and compress token output. **Always prefer them over the verbose alternatives.**

### `node.query(selector)` — CSS-like node search

Find nodes within a subtree using CSS-like selectors. Replaces verbose `findAll` + filter loops.

```js
// BEFORE — verbose traversal
const texts = frame.findAll(n => n.type === 'TEXT' && n.name === 'Title')

// AFTER — one-liner with query
const texts = frame.query('TEXT[name=Title]')
```

**Selector syntax:**
- Type: `FRAME`, `TEXT`, `RECTANGLE`, `ELLIPSE`, `COMPONENT`, `INSTANCE`, `SECTION` (case-insensitive)
- Attribute exact: `[name=Card]`, `[visible=true]`, `[opacity=0.5]`
- Attribute substring: `[name*=art]` (contains), `[name^=Header]` (starts-with), `[name$=Nav]` (ends-with)
- Dot-path traversal: `[fills.0.type=SOLID]`, `[fills.*.type=SOLID]` (wildcard index)
- Instance matching: `[mainComponent=nodeId]`, `[mainComponent.name=Button]`
- Combinators: `FRAME > TEXT` (direct child), `FRAME TEXT` (any descendant), `A + B` (adjacent sibling), `A ~ B` (general sibling)
- Pseudo-classes: `:first-child`, `:last-child`, `:nth-child(2)`, `:not(TYPE)`, `:is(FRAME, RECTANGLE)`, `:where(TEXT, ELLIPSE)`
- Node ID: `#nodeId` or bare GUID
- Comma: `TEXT, RECTANGLE` (union)
- Wildcard: `*` (any type)

**QueryResult methods:**
| Method | Description |
|---|---|
| `.length` | Number of matched nodes |
| `.first()` | First matched node (or `null`) |
| `.last()` | Last matched node (or `null`) |
| `.toArray()` | Convert to regular array |
| `.each(fn)` | Iterate with callback, returns `this` for chaining |
| `.map(fn)` | Map to new array |
| `.filter(fn)` | Filter to new QueryResult |
| `.values(keys)` | Extract property values: `.values(['name', 'x', 'y'])` → `[{name, x, y}, ...]` |
| `.set(props)` | Set properties on all matched nodes (see `node.set()` below) |
| `.query(selector)` | Sub-query within matched nodes |
| `for...of` | Iterable — works in `for` loops |

**Scope:** `node.query()` searches within that node's subtree. To search the whole page: `figma.currentPage.query('...')`. There is no global `figma.query()`.

**Examples:**
```js
// Recolor all text inside cards
figma.currentPage.query('FRAME[name^=Card] TEXT').set({
  fills: [{type: 'SOLID', color: {r: 0.2, g: 0.2, b: 0.8}}]
})

// Get names and positions of all frames
return figma.currentPage.query('FRAME').values(['name', 'x', 'y'])

// Find the first component named "Button"
const btn = figma.currentPage.query('COMPONENT[name=Button]').first()

// Find all instances of a specific component
figma.currentPage.query(`INSTANCE[mainComponent=${compId}]`)

// Find nodes with solid fills using dot-path traversal
figma.currentPage.query('[fills.0.type=SOLID]')
```

### `node.set(props)` — batch property updates

Set multiple properties in one call. Returns `this` for chaining.

```js
// BEFORE — one line per property
frame.opacity = 0.5
frame.cornerRadius = 8
frame.name = "Card"

// AFTER — single call
frame.set({ opacity: 0.5, cornerRadius: 8, name: "Card" })
```

**Priority key ordering:** `layoutMode` is always applied before other properties (like `width`/`height`) regardless of object key order. This prevents the common bug where `resize()` behaves differently depending on whether `layoutMode` is set.

**Width/height handling:** `width` and `height` are routed through `node.resize()` automatically — setting `{ width: 200 }` calls `resize(200, currentHeight)`.

**Chaining with query:**
```js
// Find all rectangles named "Divider" and update them
figma.currentPage.query('RECTANGLE[name=Divider]').set({
  fills: [{type: 'SOLID', color: {r: 0.9, g: 0.9, b: 0.9}}],
  cornerRadius: 2
})
```

### `figma.createAutoLayout(direction?, props?)` — auto-layout frames

Creates a frame with auto-layout already enabled and both axes hugging content. **This is the default container whenever children have a structural relationship to each other (see Rule 12a).**

```js
// BEFORE — manual setup, easy to get ordering wrong
const frame = figma.createFrame()
frame.layoutMode = 'VERTICAL'
frame.primaryAxisSizingMode = 'AUTO'
frame.counterAxisSizingMode = 'AUTO'
frame.layoutSizingHorizontal = 'HUG'
frame.layoutSizingVertical = 'HUG'

// AFTER — one call, layout ready
const frame = figma.createAutoLayout('VERTICAL')
```

Children can immediately use `layoutSizingHorizontal/Vertical = 'FILL'` after being appended — no need to set sizing modes manually.

Accepts an optional props object as the first or second argument:
```js
figma.createAutoLayout({ name: 'Card', itemSpacing: 12 })               // HORIZONTAL + props
figma.createAutoLayout('VERTICAL', { name: 'Column', itemSpacing: 8 })  // VERTICAL + props
```

### `node.placeholder` — shimmer overlay for AI-in-progress feedback

Sets a visual shimmer overlay on a node indicating work is in progress. **Always remove the shimmer when done** — leftover shimmers confuse users and indicate incomplete work.

```js
// Mark as in-progress
frame.placeholder = true

// ... build out the content ...

// MUST remove when done — never leave shimmers on finished nodes
frame.placeholder = false
```

When building complex layouts, set `placeholder = true` on sections before populating them, then set `placeholder = false` on each section as it's completed.

### `await node.screenshot(opts?)` — inline screenshots

Capture a node as a PNG and return it inline in the response. Eliminates the need for a separate `get_screenshot` call.

```js
// Take a screenshot of a frame (returned inline in the tool response)
await frame.screenshot()

// Custom scale (default auto-scales: 0.5x or capped so max dimension ≤ 1024px)
await frame.screenshot({ scale: 2 })

// Include overlapping content from sibling nodes
await frame.screenshot({ contentsOnly: false })
```

**When to use:** Follow Rule 5. Take a composition screenshot when visual evidence is needed. If a visual fix follows, take one post-fix screenshot; that passing screenshot is final. Do not take an additional unchanged “final” screenshot.

**Auto-naming:** The image caption includes node metadata — `"Card (300x150 at 0,60).png"` — giving spatial context without parsing the image.

**Default scaling:** Uses 0.5x scale, but automatically caps so the largest output dimension never exceeds 1024px. Explicit `{ scale: N }` bypasses the cap.

## 6. Incremental Workflow (How to Avoid Bugs)

The most common causes of waste are unnecessary fragmentation, redundant validation, and scripts that cannot be retried safely. **Use Rule 5's safe-retry and evidence-based validation contract.**

### Key rules

- **Choose call boundaries for recoverability, not validation cadence.** Batch related creation, property updates, parenting, and targeted diagnostics when safe. A complete page may be one call; do not split it into header/content/footer calls merely to validate each section. **Slides override:** in Slides files, slides are isolated subtrees — the relevant limit is complexity per slide, not total nodes across slides. Building 3–5 new slides in one call is safe, and so is applying the same edit (e.g. adding a footer, recoloring a heading) across every slide in the deck in a single call. See [figma-use-slides](../figma-use-slides/SKILL.md) for the deck-building workflow.
- **Build top-down, starting with placeholders.** Create the outer structure first with `placeholder = true` on each section, then incrementally replace placeholders with real content in subsequent calls.

### The pattern

1. **Inspect first.** Before creating anything, run a read-only `use_figma` to discover what already exists in the file — pages, components, variables, naming conventions. Match what's there.
2. **Build the skeleton.** Create the top-level structure with placeholder sections. Set `placeholder = true` on each section so the user sees progress.
3. **Fill in content in retry-safe batches.** Multiple related sections may be populated together when the operation remains safe to retry. Set each section's `placeholder = false` when done.
4. **Return IDs from every call** (Rule 15) — you'll need created node/variable/collection IDs as inputs to subsequent calls.
5. **Return validation evidence from writes.** Return IDs and the relevant counts, names, hierarchy, or bounds. Add a separate audit only for missing evidence or after a mutation invalidates earlier evidence. Follow Rule 5 for visual checks.
6. **Fix before moving on.** If validation reveals a problem, fix it before proceeding to the next step. Don't build on a broken foundation.

### Suggested step order for complex tasks

```
Step 1: Inspect file — discover existing pages, components, variables, conventions
Step 2: Create tokens/variables (if needed)
       → return collection, variable, and mode counts
Step 3: Create individual components
       → return component IDs and relevant child/variant counts
Step 4: Compose layouts from component instances
       → return layout IDs/bounds + take a composition screenshot
Step 5: Apply a targeted visual fix only if needed
       → take one post-fix screenshot; this is final
Step 6: Stop if nothing relevant changed
```

### What to validate at each step

| After... | Check with `get_metadata` | Check with `get_screenshot` |
|---|---|---|
| Creating variables | Collection count, variable count, mode names | — |
| Creating components | Child count, variant names, property definitions | Variants visible, not collapsed, grid readable |
| Binding variables | Node properties reflect bindings | Colors/tokens resolved correctly |
| Composing layouts | Instance nodes have mainComponent, hierarchy correct | No cropped/clipped text, no overlapping elements, correct spacing |

## 7. Error Recovery & Self-Correction

On any `use_figma` error, obey `safeToRetryWithoutCanvasRead` (Rule 14): `true` → correct the identified error and retry without adding a diagnostic canvas read; `false` → read the canvas, determine what changed, then make changes. If the same API or property error occurs twice, inspect its definition once and fix the root cause before retrying; do not continue decomposing the operation around the same invalid mutation. Errors whose fix is already a Critical Rule are diagnosed there — `"not implemented"` (`figma.notify`, Rule 3), the `layoutSizing*` HUG/FILL rejections (Rules 12, 12b), `"Setting figma.currentPage is not supported"` (Rule 9), `componentPropertyDefinitions` on a variant (Rule 18), and `characters`/`description` on the wrong node type (Rules 3a, 3b). The rows below cover failures the contract doesn't name:

| Error message | Likely cause | How to fix |
|---|---|---|
| Property value out of range | Color channel > 1 (used 0–255 instead of 0–1) | Divide by 255 |
| `"Cannot read properties of null"` | Node doesn't exist (wrong ID, wrong page) | Check page context, verify ID |
| Script hangs / no response | Infinite loop or unresolved promise | Check for `while(true)` or missing `await`; ensure code terminates |
| `"The node with id X does not exist"` | Parent instance was implicitly detached by a child `detachInstance()`, changing IDs | Re-discover nodes by traversal from a stable (non-instance) parent frame |

### When the script succeeds but the result looks wrong

Call `get_metadata` for structural correctness (hierarchy, counts, positions) and `get_screenshot` for visual correctness — look closely for cropped/clipped text (line heights cutting off content) and overlapping elements, which are common and easy to miss. Identify whether the discrepancy is structural or visual, then write a **targeted** fix script that modifies only the broken parts — don't recreate everything.

> For the full validation workflow, see [Validation & Error Recovery](references/validation-and-recovery.md).

## 8. Pre-Flight Checklist
Before submitting ANY `use_figma` call, re-read the script against the operating contract in [Section 1](#1-critical-rules). Every gate that used to be enumerated here now lives there — a script that violates any of these is not ready to submit:

- [ ] **Output** — uses `return` (not `figma.closePlugin()`), not wrapped in an async IIFE, no `console.log()` as output; `return`s structured data with ALL created/mutated node IDs (Rules 1, 2, 4, 15)
- [ ] **Color & fills** — 0–1 range; paint `color` is `{r, g, b}` only (no `a`); fills/strokes reassigned as new arrays (Rules 6, 7)
- [ ] **Type narrowing** — `characters`, `description`, and `componentPropertyDefinitions` guarded/narrowed before access (Rules 3a, 3b, 18)
- [ ] **Pages** — switches use `await figma.setCurrentPageAsync(page)`, at most once per call (Rule 9)
- [ ] **Layout & sizing** — related children in `figma.createAutoLayout()`; top-level nodes positioned away from (0,0); `HUG`/`FILL` set after `appendChild`; `resize()` before sizing modes; wrapping TEXT uses `textAutoResize='HEIGHT'` + FIXED width (Rules 12, 12a, 12b, 12c, 13)
- [ ] **Text** — canonical font recipe with style names verified via `listAvailableFontsAsync()`; `lineHeight`/`letterSpacing` as `{unit, value}`; `FONT_FAMILY` variables load every mode's value first (Rule 8)
- [ ] **Async & state** — every Promise `await`ed; multi-step IDs passed as string literals (Rules 15, 17)

## 9. Discover Conventions Before Creating

**Always inspect the Figma file before creating anything.** Different files use different naming conventions, variable structures, and component patterns. Your code should match what's already there, not impose new conventions.

When in doubt about any convention (naming, scoping, structure), check the Figma file first, then the user's codebase. Only fall back to common patterns when neither exists.

### Quick inspection scripts

**List all pages and top-level nodes:**
```js
const pages = figma.root.children.map(p => `${p.name} id=${p.id} children=${p.children.length}`);
return pages.join('\n');
```

**List existing components across all pages:**

`search_design_system` is an option for published components. For on-canvas components, use the two-step fan-out — **don't loop pages inside one script.**

Step 1: one read-only `use_figma` to get page IDs:
```js
return figma.root.children.map(p => ({ id: p.id, name: p.name }));
```

Step 2: in the **next assistant turn, emit one `use_figma` per page in parallel** (a single message containing N tool-use blocks). Each runs:
```js
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
// findAllWithCriteria uses an indexed type lookup — hundreds of times faster
// than the findAll(n => n.type === '…') side-effect-in-predicate antipattern.
const matches = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
return matches.map(n => ({ page: page.name, name: n.name, type: n.type, id: n.id }));
```

**List existing variable collections and their conventions:**
```js
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const results = collections.map(c => ({
  name: c.name, id: c.id,
  varCount: c.variableIds.length,
  modes: c.modes.map(m => m.name)
}));
return results;
```

## 10. Reference Docs

Load these as needed based on what your task involves:

| Doc | When to load | What it covers |
|-----|-------------|----------------|
| [gotchas.md](references/gotchas.md) | Before any `use_figma` | Every known pitfall with WRONG/CORRECT code examples — start with the [canonical text-edit recipe](references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids) |
| [common-patterns.md](references/common-patterns.md) | Need working code examples | Script scaffolds: shapes, text, auto-layout, variables, components, multi-step workflows |
| [plugin-api-patterns.md](references/plugin-api-patterns.md) | Creating/editing nodes | Fills, strokes, Auto Layout, effects, grouping, cloning, styles |
| [api-reference.md](references/api-reference.md) | Need exact API surface | Node creation, variables API, core properties, what works and what doesn't |
| [validation-and-recovery.md](references/validation-and-recovery.md) | Multi-step writes or error recovery | `get_metadata` vs `get_screenshot` workflow, mandatory error recovery steps |
| [component-patterns.md](references/component-patterns.md) | Creating components/variants | combineAsVariants, component properties, INSTANCE_SWAP, variant layout, discovering existing components, metadata traversal |
| [variable-patterns.md](references/variable-patterns.md) | Creating/binding variables | Collections, modes, scopes, aliasing, binding patterns, discovering existing variables |
| [text-style-patterns.md](references/text-style-patterns.md) | Creating/applying text styles | Type ramps, font discovery via `listAvailableFontsAsync`, listing styles, applying styles to nodes |
| [effect-style-patterns.md](references/effect-style-patterns.md) | Creating/applying effect styles | Drop shadows, listing styles, applying styles to nodes |
| [plugin-api-standalone.index.md](references/plugin-api-standalone.index.md) | Need to understand the full API surface | Index of all types, methods, and properties in the Plugin API |
| [plugin-api-standalone.d.ts](references/plugin-api-standalone.d.ts) | Need exact type signatures | Full typings file — grep for specific symbols, don't load all at once |

## 11. Snippet examples

You will see snippets throughout documentation here. These snippets contain useful plugin API code that can be repurposed. Use them as is, or as starter code as you go. If there are key concepts that are best documented as generic snippets, call them out and write to disk so you can reuse in the future.
