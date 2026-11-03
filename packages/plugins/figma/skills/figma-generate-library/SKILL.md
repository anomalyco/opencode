---
name: figma-generate-library
description: "Build or update a professional-grade design system in Figma from a codebase. Use when the user wants to create variables/tokens, build component libraries, create individual components with proper variant sets and variable bindings, set up theming (light/dark modes), document foundations, or reconcile gaps between code and Figma. Also use when the user asks to create or generate any component in Figma — even a single one — since components require proper variable foundations, variant states, and design token bindings to be production-quality. This skill teaches WHAT to build and in WHAT ORDER — it complements the `figma-use` skill which teaches HOW to call the Plugin API. Both skills should be loaded together."
disable-model-invocation: false
---

# Design System Builder — Figma MCP Skill

Build professional-grade design-system assets in Figma that match code. Scale the workflow to the requested deliverable: a token set, one component, a complete library, or a targeted reconciliation. Run the selected path in coherent, safely retryable construction phases with evidence-based validation.

**Prerequisites**: The `figma-use` skill MUST also be loaded for every `use_figma` call. It provides Plugin API syntax rules (return pattern, page reset, ID return, font loading, color range). This skill provides design system domain knowledge and workflow orchestration.

**Always include `figma-generate-library` in the comma-separated `skillNames` parameter when calling `use_figma` as part of this skill. If this skill was loaded via an MCP resource, you MUST prefix the name with `resource:` (e.g. `resource:figma-generate-library`).** This is a logging parameter — it does not affect execution.

---

## 1. Scope and Completion Contract

Before the first mutation, choose one primary scope from the user's request and record its included deliverables and acceptance checks. Do not silently promote a narrower request into a full-library project.

| Requested scope | Required work | Excluded unless requested or necessary |
|---|---|---|
| **Tokens / foundations only** | Requested variables, modes, scopes, code syntax, styles, and any requested specimen sheet | Components, component pages, Code Connect, full-library navigation |
| **Single component or family** | Inspect and reuse compatible foundations; create only missing tokens the component requires; build requested variants/properties/bindings; validate the component | Unrelated foundations, other components, full file skeleton, broad documentation or audits |
| **Full library / design system** | Discovery, foundations, file structure, requested component inventory, documentation, integration, and final QA | Work outside the agreed v1 inventory |
| **Reconciliation / update** | Diff code and Figma, then update only affected tokens, styles, components, docs, and dependents | Rebuilding valid assets or expanding the library |

Communicate proportionally: post one concise scope-and-acceptance checklist before mutations, give updates at meaningful boundaries, and finish with one summary of created or changed objects, validation evidence, and unresolved limitations. Do not repeat unchanged checklists or narrate every API call.

Batch related operations when the resulting script stays safe to retry. Split at page-context boundaries, hard-to-recover mutations, or for a targeted retry after an actual failure; never split a working operation only to create a validation checkpoint. Keep mutations sequential. Use structural evidence returned by writes (IDs plus relevant counts, names, and bounds), and run a separate audit only when evidence is missing or a later mutation made it stale. Take one visual review per coherent composition phase and one post-fix screenshot only after a targeted visual fix; the latest passing screenshot is final.

### Definition of done

Stop when all conditions for the chosen scope are true:

- The final deliverable covers the locked inventory and is materially faithful to the applicable source of truth, including requested variant/state coverage, required assets, and in-scope review examples.
- For component tasks, keep main components and construction assets outside the final review frame, and show the requested states as instances in one compact frame. Before stopping, inspect that frame at normal scale and repair clipped, truncated, low-contrast, empty, misplaced, or detached content.
- Required variable scopes, aliases, code syntax, component properties, variants, and bindings are verified.
- The requested artifact passes applicable structural and visual validation. Confirm requested content is fully visible unless clipping or truncation is intentional; repair defects and recheck only the affected output.
- Replace placeholders when the source provides the required asset; remove temporary instances, test frames, captures, abandoned artifacts, and unrelated stray nodes.
- No known defect or unresolved decision prevents the agreed acceptance checks from passing. Report limitations outside the scope without starting extra work.

Additional documentation, components, Code Connect mappings, accessibility sweeps, or speculative audits are follow-up work unless the chosen scope requires them. Once the definition of done passes, stop.

### Scope changes

If the user changes the deliverable, update the scope and acceptance checklist. Preserve verified work, run only newly applicable steps, and do not retroactively add work from an unselected path.

---

## 2. Scoped Workflow

Every scope begins with focused discovery: analyze the relevant code, inspect the target Figma assets and conventions, call `get_libraries` before `search_design_system`, and resolve code/Figma conflicts before mutation. Batch independent searches and reuse their results. Lock the requested inventory, then run only its path below.

### Tokens / foundations

1. Create or update the requested collections, modes, primitives, semantic aliases, scopes, and code syntax.
2. Create requested text and effect styles.
3. Create a specimen or documentation page only when requested.
4. Validate counts, mode values, aliases, scopes, syntax, styles, and any requested visual artifact; then stop.

### Single component or family

1. Inspect and reuse compatible local or library variables, text styles, and effect styles. Create only the missing foundations required by the component. For source-defined, library-standard, or repeated component roles, create or reuse a shared text or effect style and apply it to every matching component node; keep one-off documentation inline.
2. Build the requested base component, variants, properties, bindings, and dependency components.
3. Use a dedicated page when it matches the file convention or the request needs a documented showcase; otherwise place it in the existing component area.
4. Validate variant count, properties, variable bindings, applied text/effect style IDs on representative nodes, structure, and appearance; then stop.

### Full library / design system

1. **Discovery:** lock the token and component inventory and print the gap analysis.
2. **Foundations:** create collections, variables, aliases, scopes, code syntax, and styles.
3. **File structure:** create the agreed cover, getting-started, foundations, component, and utility pages plus requested documentation.
4. **Components:** build the agreed inventory in dependency order, with properties, bindings, documentation, and validation.
5. **Integration and QA:** complete Code Connect mappings for the agreed component inventory; audit accessibility, naming, and bindings; and visually validate every agreed page.

### Reconciliation / update

1. Inventory existing assets and identify exact drift from the current code source.
2. Update affected assets in place, preserving valid names, IDs, bindings, and library structure where possible.
3. Validate the changed assets and their known dependents; then stop.

If a required acceptance check fails, fix the scoped defect before continuing. Do not substitute fake assets, approximate typography, broken interactions, or unverified state.

The selected path and definition of done take precedence over broader examples or full-library phase labels in the references. Load only references needed for that path.

---

## 3. Critical Rules

**Plugin API basics** (from use_figma skill — enforced here too):
- Use `return` to send data back (auto-serialized). Do NOT wrap in IIFE or call closePlugin.
- Return ALL created/mutated node IDs in every return value
- Page context resets each call — always `await figma.setCurrentPageAsync(page)` at start. **Call it at most once per script**: each component or doc page is its own `use_figma` call. Never loop over `figma.root.children` and switch pages inside a mutating script — split that work into one focused call per target page (see [figma-use → gotchas.md → Set current page once per `use_figma` call](../figma-use/references/gotchas.md#set-current-page-once-per-use_figma-call--split-multi-page-work-across-calls))
- `figma.notify()` throws — never use it
- Colors are 0–1 range, not 0–255
- Font MUST be loaded before any text write: `await figma.loadFontAsync({family, style})`. Use `await figma.listAvailableFontsAsync()` to discover available fonts and verify exact style strings — if a load fails, query available fonts to find the correct name or a fallback.

**Design system rules**:
1. **Foundations before dependent components** — reuse compatible existing variables and styles. Create missing foundations before building a component that depends on them; do not recreate valid foundations.
2. **Inspect before creating** — run read-only `use_figma` to discover existing conventions. Match them.
3. **Match the file's component organization** — full libraries usually use one page per component; tightly related families may share a page. A single-component task may use an existing component area instead of creating a library skeleton.
4. **Bind visual properties to variables** *(default)* — fills, strokes, padding, radius, gap. Exceptions: intentionally fixed geometry (icon pixel-grid sizes, static dividers).
5. **Scopes on every variable** — NEVER leave as `ALL_SCOPES`. Background: `FRAME_FILL, SHAPE_FILL`. Text: `TEXT_FILL`. Border: `STROKE_COLOR`. Spacing: `GAP`. Radii: `CORNER_RADIUS`. Primitives: `[]` (hidden).
6. **Code syntax on every variable** — WEB syntax MUST use the `var()` wrapper: `var(--color-bg-primary)`, not `--color-bg-primary`. Use the actual CSS variable name from the codebase. ANDROID/iOS do NOT use a wrapper.
7. **Alias semantics to primitives** — `{ type: 'VARIABLE_ALIAS', id: primitiveVar.id }`. Never duplicate raw values in semantic layer.
8. **Position variants after combineAsVariants** — they stack at (0,0). Manually grid-layout + resize.
9. **INSTANCE_SWAP for icons** — never create a variant per icon. Cap variant matrices: if Size × Style × State > 30 combinations, split into sub-component.
10. **Deterministic naming** — use consistent, unique node names for idempotent cleanup and resumability. Track created node IDs via return values and the state ledger.
11. **No destructive cleanup** — cleanup scripts identify nodes by name convention or returned IDs, not by guessing.
12. **Validate from evidence before proceeding** — never build on unvalidated work. Rely on the structural evidence returned by writes (IDs plus relevant counts, names, and bounds); run one batched structural audit per coherent phase only when needed to establish the acceptance checks or when a relevant mutation invalidated prior evidence. Take one visual review per coherent composition phase, plus one post-fix screenshot only after a targeted visual fix.
13. **NEVER parallelize `use_figma` calls** — Figma state mutations must be strictly sequential. Even if your tool supports parallel calls, never run two use_figma calls simultaneously.
14. **Never hallucinate Node IDs** — always read IDs from the state ledger returned by previous calls. Never reconstruct or guess an ID from memory.
15. **Use the helper scripts** — embed scripts from `scripts/` into your use_figma calls. Don't write 200-line inline scripts from scratch.

---

## 4. State Management (Required for Long Workflows)

> Do not store workflow state on Figma objects. Use deterministic names for discovery and exact returned IDs in the state ledger. Put human-readable component purpose and usage guidance in the component or component-set `description`.

| Entity type | Stable identity | How to check existence |
|-------------|----------------|----------------------|
| Pages and frames | Deterministic name + state-ledger ID | `figma.root.children.find(p => p.name === pageName)` or `await figma.getNodeByIdAsync(id)` |
| Components and component sets | Variant/set name + state-ledger ID | `page.findOne(n => n.name === name)` or `await figma.getNodeByIdAsync(id)` |
| Variables | Name within collection | `(await figma.variables.getLocalVariablesAsync()).find(v => v.name === name && v.variableCollectionId === collId)` |
| Styles | Name | `getLocalTextStyles().find(s => s.name === name)` |

Record every returned ID in the state ledger immediately after creation. Never use a fuzzy lookup to authorize deletion.

**State persistence**: Do NOT rely solely on conversation context for the state ledger. Write it to disk:
```
/tmp/design-system-state-{RUN_ID}.json
```
Re-read this file at the start of every turn. In long workflows, conversation context will be truncated — the file is the source of truth.

Maintain a state ledger tracking:
```json
{
  "runId": "ds-build-2024-001",
  "scope": "single-component",
  "step": "component-button",
  "entities": {
    "collections": { "primitives": "id:...", "color": "id:..." },
    "variables": { "color/bg/primary": "id:...", "spacing/sm": "id:..." },
    "pages": { "Cover": "id:...", "Button": "id:..." },
    "components": { "Button": "id:..." }
  },
  "pendingValidations": ["Button:screenshot"],
  "completedSteps": ["discovery", "foundations/verified", "component-button/base"]
}
```

**Idempotency check** before every create: query by name + state ledger ID. If exists, skip or update — never duplicate.

**Resume protocol**: at session start or after context truncation, run a read-only `use_figma` to scan all pages, components, variables, and styles by name to reconstruct the `{key → id}` map. Then re-read the state file from disk if available.

**Continuation prompt** (give this to the user when resuming in a new chat):
> "I'm continuing a design system build. Run ID: {RUN_ID}. Load the figma-generate-library skill and resume from the last completed step."

---

## 5. Library Discovery and search_design_system — Reuse Decision Matrix

Search during the scoped discovery pass and reuse the results. Search again before a component only when it was outside the original inventory, the available libraries changed, or the earlier result did not resolve it.

Before calling `search_design_system` for a target file, you MUST call `get_libraries` first for that file. You MUST NOT assume libraries are added or available.

An empty `get_libraries` result does NOT excuse skipping the search — it only means you have no library keys to scope with. `get_libraries` paginates (community UI kits appear only on the first page, org libraries page in batches of 20), so empty lists are not proof that no library exists. How to act on the result:

- **Libraries returned** — run `search_design_system` scoped with `includeLibraryKeys`. Libraries in `libraries_available_to_add` are NOT searched by default; pass their `libraryKey`s to reach them.
- **No libraries returned** — still run `search_design_system`, but omit `includeLibraryKeys`. Omitting it scopes the search to the file itself, which is exactly what you want when discovery returned nothing to scope by.

Only once the search itself comes back empty may you record "no design system assets available" in the gap analysis and build from code tokens. Never infer "no libraries" from a failed or unattempted `get_libraries` call.

```
// Discover all libraries accessible to the file
get_libraries({ fileKey })
// Returns:
//   libraries_added_to_file: [{ name, libraryKey, description, source }, ...]
//   libraries_available_to_add: [{ name, libraryKey, description, source }, ...]
//   libraries_available_to_add_next_offset: number | null
```

Use the returned `libraryKey` values to scope searches to specific libraries via `includeLibraryKeys`. This avoids noisy results when many libraries are available.

If `libraries_available_to_add_next_offset` is non-null, more org libraries are available — call `get_libraries` again with `offset` set to that value. Org libraries page in batches of 20; community UI kits only appear on the first page.

```
// Search across all libraries (default)
search_design_system({
  queries: [
    { entity: "component", query },
    { entity: "variable", query },
    { entity: "style", query }
  ],
  fileKey
})

// Search within a specific library only
search_design_system({ queries: [{ entity: "component", query }], fileKey, includeLibraryKeys: ["lk-abc123..."] })
```

**Reuse if** all of these are true:
- Component property API matches your needs (same variant axes, compatible types)
- Token binding model is compatible (uses same or aliasable variables)
- Naming conventions match the target file
- Component is editable (not locked in a remote library you don't own)

**Rebuild if** any of these:
- API incompatibility (different property names, wrong variant model)
- Token model incompatible (hardcoded values, different variable schema)
- Ownership issue (can't modify the library)

**Wrap if** visual match but API incompatible:
- Import the library component as a nested instance inside a new wrapper component
- Expose a clean API on the wrapper

**Priority order**: local existing → subscribed library import → unsubscribed UI Kit library from `libraries_available_to_add` (icons especially) → create new.

---

## 6. Decision Forks

Ask the user when paths fork — when two or more reasonable answers exist and no clear winner comes from the codebase, the Figma file, or the locked plan. Don't silently default. Present each option with its tradeoff and your recommendation; pick only after the user steers.

**When NOT to ask:** if exactly one path is clearly correct from the source of truth (code, Figma file, agreed plan), take it. This section is for genuine ambiguity, not for offloading every decision.

| Fork situation | What to surface | Example ask |
|---|---|---|
| Code ≠ Figma on a token, component, or value | Both versions side by side, with provenance (file/line vs node) | "Code says `--color-bg-primary = #FFFFFF`, Figma has `color/bg/primary = #FAFAFA`. Which wins?" |
| Subscribed library has a close-but-not-exact match | Library component summary + gap list | "Library has `Button` with no `loading` state. Reuse + wrap locally, or rebuild from scratch?" |
| Scope ambiguity at plan-lock (0d) | What's clearly in, what's clearly out, what's ambiguous | "Spec lists `Button` and `Input`; `Field` is referenced but not defined. In or out of v1?" |

**If the user rejects an option you already built on:** fix before moving on. Never build on rejected work.

---

## 7. Naming Conventions

Match existing file conventions. If starting fresh:

**Variables** (slash-separated):
```
color/bg/primary     color/text/secondary    color/border/default
spacing/xs  spacing/sm  spacing/md  spacing/lg  spacing/xl  spacing/2xl
radius/none  radius/sm  radius/md  radius/lg  radius/full
typography/body/font-size    typography/heading/line-height
```

**Primitives**: `blue/50` → `blue/900`, `gray/50` → `gray/900`

**Component names**: `Button`, `Input`, `Card`, `Avatar`, `Badge`, `Checkbox`, `Toggle`

**Variant names**: `Property=Value, Property=Value` — e.g., `Size=Medium, Style=Primary, State=Default`

**Page separators**: `---` (most common) or `——— COMPONENTS ———`

> Full naming reference: [naming-conventions.md](references/naming-conventions.md)

---

## 8. Token Architecture

| Complexity | Pattern |
|-----------|---------|
| < 50 tokens | Single collection, 2 modes (Light/Dark) |
| 50–200 tokens | **Standard**: Primitives (1 mode) + Color semantic (Light/Dark) + Spacing (1 mode) + Typography (1 mode) |
| 200+ tokens | **Advanced**: Multiple semantic collections, 4–8 modes (Light/Dark × Contrast × Brand). See M3 pattern in [token-creation.md](references/token-creation.md) |

Standard pattern (recommended starting point):
```
Collection: "Primitives"    modes: ["Value"]
  blue/500 = #3B82F6, gray/900 = #111827, ...

Collection: "Color"         modes: ["Light", "Dark"]
  color/bg/primary → Light: alias Primitives/white, Dark: alias Primitives/gray-900
  color/text/primary → Light: alias Primitives/gray-900, Dark: alias Primitives/white

Collection: "Spacing"       modes: ["Value"]
  spacing/xs = 4, spacing/sm = 8, spacing/md = 16, ...
```

---

## 9. Anti-Patterns

**Discovery and scope:**
- ❌ Ignoring existing conventions or skipping relevant code, file, and library discovery
- ❌ Expanding a narrow request into unrelated foundations, documentation, or a full library

**Foundations:**
- ❌ Using `ALL_SCOPES`, duplicating primitive values in the semantic layer, or omitting code syntax
- ❌ Creating dependent components before their foundations exist

**Components:**
- ❌ Hardcoding component fills, strokes, spacing, or radii when compatible variables exist
- ❌ Creating a variant per icon instead of using INSTANCE_SWAP
- ❌ Leaving variants stacked at (0,0) after `combineAsVariants`
- ❌ Building a variant matrix larger than 30 without splitting it
- ❌ Importing remote components and immediately detaching them

**Execution and recovery:**
- ❌ Retrying when `safeToRetryWithoutCanvasRead` is `false` before reading the canvas
- ❌ Using name-prefix matching for cleanup (deletes user-owned nodes)
- ❌ Building on unvalidated work from the previous step
- ❌ Parallelizing use_figma calls (always sequential)
- ❌ Guessing/hallucinating node IDs from memory (always read from state ledger)
- ❌ Writing massive inline scripts instead of using the provided helper scripts

---

## 10. Reference Docs

Read references on demand; do not infer their contents from the filename.

| Doc | Load when |
|-----|-----------|
| [discovery-phase.md](references/discovery-phase.md) | Analyzing relevant code and Figma assets before mutation |
| [token-creation.md](references/token-creation.md) | Creating variables, collections, modes, or styles |
| [documentation-creation.md](references/documentation-creation.md) | The selected scope includes cover or foundations documentation |
| [component-creation.md](references/component-creation.md) | Creating a component or variant |
| [code-connect-setup.md](references/code-connect-setup.md) | The selected scope includes Code Connect or variable code syntax |
| [naming-conventions.md](references/naming-conventions.md) | Naming variables, pages, variants, or styles |
| [error-recovery.md](references/error-recovery.md) | A script fails or abandoned workflow state needs cleanup |

---

## 11. Scripts

Reusable Plugin API helper functions. Embed in `use_figma` calls:

| Script | Purpose |
|--------|---------|
| [inspectFileStructure.js](scripts/inspectFileStructure.js) | Discover all pages, components, variables, styles; returns full inventory |
| [createVariableCollection.js](scripts/createVariableCollection.js) | Create a named collection with modes; returns `{collectionId, modeIds}` |
| [createSemanticTokens.js](scripts/createSemanticTokens.js) | Create aliased semantic variables from a token map |
| [createComponentWithVariants.js](scripts/createComponentWithVariants.js) | Build a component set from a variant matrix; handles grid layout |
| [bindVariablesToComponent.js](scripts/bindVariablesToComponent.js) | Bind design tokens to all component visual properties |
| [createDocumentationPage.js](scripts/createDocumentationPage.js) | Create a page with title + description + section structure |
| [validateCreation.js](scripts/validateCreation.js) | Verify created nodes match expected counts, names, structure |
| [cleanupOrphans.js](scripts/cleanupOrphans.js) | Remove only the exact node, variable, and collection IDs supplied from the state ledger |
