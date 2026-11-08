---
name: figma-code-connect
description: Creates and maintains Figma Code Connect template files that map Figma components to code snippets. Use when the user mentions Code Connect, Figma component mapping, design-to-code translation, or asks to create/update .figma.ts or .figma.js files.
disable-model-invocation: false
---

# Code Connect

## Overview

Create Code Connect template files (`.figma.ts`) that map Figma components to code snippets. Given a Figma URL, follow the steps below to create a template.

> **You write `.figma.ts` template files ONLY — never `.figma.tsx`.** This skill produces *parserless templates*: a `.figma.ts` file whose default export uses a `` figma.code`...` `` tagged template. Do **NOT** write a `.figma.tsx` file and do **NOT** use `figma.connect()` — that is the separate **parser-based** Code Connect format (published a different way) and is the **wrong artifact** for this skill; output written as `.figma.tsx` is rejected outright. If a `.figma.tsx` already exists for a component, leave it untouched and add your `.figma.ts` template alongside it. A capable model may be tempted to reach for the more familiar `.figma.tsx` / `figma.connect()` pattern from memory — resist it; here the correct output is **always** `.figma.ts` + `figma.code`.

## Prerequisites

- **Figma MCP server must be connected** — verify that Figma MCP tools (e.g., `get_code_connect_suggestions`) are available before proceeding. If not, guide the user to enable the Figma MCP server and restart their MCP client.
- **Components must be published** — Code Connect only works with components published to a Figma team library. If a component is not published, inform the user and stop.
- **Organization or Enterprise plan required** — Code Connect is not available on Free or Professional plans.
- **URL must include `node-id`** — the Figma URL must contain the `node-id` query parameter.
- **TypeScript types** — for editor autocomplete and type checking in `.figma.ts` files `@figma/code-connect/figma-types` must be added to `types` in `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "types": ["@figma/code-connect/figma-types"]
    }
  }
  ```

## Step 1: Parse the Figma URL

Extract `fileKey` and `nodeId` from the URL:

| URL Format | fileKey | nodeId |
|---|---|---|
| `figma.com/design/:fileKey/:name?node-id=X-Y` | `:fileKey` | `X-Y` → `X:Y` |
| `figma.com/file/:fileKey/:name?node-id=X-Y` | `:fileKey` | `X-Y` → `X:Y` |
| `figma.com/design/:fileKey/branch/:branchKey/:name` | use `:branchKey` | from `node-id` param |

Always convert `nodeId` hyphens to colons: `1234-5678` → `1234:5678`.

**Worked example:**

Given: `https://www.figma.com/design/QiEF6w564ggoW8ftcLvdcu/MyDesignSystem?node-id=4185-3778`
- `fileKey` = `QiEF6w564ggoW8ftcLvdcu`
- `nodeId` = `4185-3778` → `4185:3778`

## Step 2: Discover Unmapped Components

The user may provide a URL pointing to a frame, instance, or variant — not necessarily a component set or standalone component. Call the MCP tool `get_code_connect_suggestions` with:
- `fileKey` — from Step 1
- `nodeId` — from Step 1 (colons format)
- `excludeMappingPrompt` — `true` (returns a lightweight list of unmapped components)

This tool identifies published components in the selection that don't yet have Code Connect mappings.

**Handle the response:**

- **"No published components found in this selection"** — the node contains no published components. Inform the user they need to publish the component to a team library in Figma first, then stop.
- **"All component instances in this selection are already connected to code via Code Connect"** — everything is already mapped. Inform the user and stop.
- **Normal response with component list** — extract the `mainComponentNodeId` for each returned component. Use these resolved node IDs (not the original from the URL) for all subsequent steps. If multiple components are returned (e.g. the user selected a frame containing several different component instances), repeat Steps 3–6 for each one.

## Step 3: Fetch Component Properties

Call the MCP tool `get_context_for_code_connect` with:
- `fileKey` — from Step 1
- `nodeId` — the resolved `mainComponentNodeId` from Step 2
- `clientFrameworks` — determine from `figma.config.json` `parser` field (e.g. `"react"` → `["react"]`)
- `clientLanguages` — infer from project file extensions (e.g. TypeScript project → `["typescript"]`, JavaScript → `["javascript"]`)

For multiple components, call the tool once per node ID.

The response contains the Figma component's **property definitions** — note each property's name and type:
- **TEXT** — text content (labels, titles, placeholders)
- **BOOLEAN** — toggles (show/hide icon, disabled state)
- **VARIANT** — enum options (size, variant, state)
- **INSTANCE_SWAP** — swappable nested instances tied to a specific component (icon, avatar)
- **SLOT** — flexible content regions (freeform layout, mixed children); use `getSlot()` in templates (not the same as INSTANCE_SWAP)

Save this property list — you will use it in Step 5 to write the template.

## Step 4: Identify the Code Component

If the user did not specify which code component to connect:

1. Check `figma.config.json` for `paths` and `importPaths` to find where components live
2. Search the codebase for a component matching the Figma component name. Check common directories (`src/components/`, `components/`, `lib/ui/`, `app/components/`) if `figma.config.json` doesn't specify paths
3. Read candidate files and compare their props interface against the Figma properties from Step 3 — look for matching variant types, size options, boolean flags, and slot props
4. If multiple candidates match, pick the one with the closest prop-interface match and explain your reasoning to the user
5. If no match is found, show the 2 closest candidates and ask the user to confirm or provide the correct path

**Confirm with the user** before proceeding to Step 5. Present the match: which code component you found, where it lives, and why it matches (prop correspondence, naming, purpose).

Read `figma.config.json` for import path aliases — the `importPaths` section maps glob patterns to import specifiers, and the `paths` section maps those specifiers to directories.

Read the code component's source to understand its props interface — this informs how to map Figma properties to code props in Step 5.

## Step 5: Create the Template File (.figma.ts)

### File location

Place the file alongside existing Code Connect files. Check `figma.config.json` `include` patterns for the correct directory. **Name it `ComponentName.figma.ts` — never `ComponentName.figma.tsx`.** The `.figma.tsx` extension is the parser-based format; do not create one or modify an existing one.

### Template structure

Every template file follows this structure:

```ts
// url=https://www.figma.com/file/{fileKey}/{fileName}?node-id={nodeId}
// source={path to code component from Step 4}
// component={code component name from Step 4}
import figma from 'figma'
const instance = figma.selectedInstance

// Extract properties from the Figma component (see property mapping below)
// ...

export default {
  example: figma.code`<Component ... />`,       // Required: code snippet
  imports: ['import { Component } from "..."'], // Optional: import statements
  id: 'component-name',                         // Required: unique identifier
  metadata: {                                    // Optional
    nestable: true,                              // true = inline in parent, false = show as pill
    props: {}                                    // data accessible to parent templates
  }
}
```

### Property mapping

Use the property list from Step 3 to extract values. For each Figma property type, use the corresponding method:

| Figma Property Type | Template Method | When to Use |
|---|---|---|
| TEXT | `instance.getString('Name')` | Labels, titles, placeholder text |
| BOOLEAN | `instance.getBoolean('Name', { true: ..., false: ... })` | Toggle visibility, conditional props |
| VARIANT | `instance.getEnum('Name', { 'FigmaVal': 'codeVal' })` | Size, variant, state enums |
| INSTANCE_SWAP | `instance.getInstanceSwap('Name')` | Swapped instance for a fixed component slot (then `hasCodeConnect()` / `executeTemplate()`) - do not confuse with the SLOT property below |
| SLOT | `instance.getSlot('Name')` | Freeform slot content only when the Figma property type is **SLOT** 
| (child layer) | `instance.findInstance('LayerName')` | Named child instances without a property |
| (text layer) | `instance.findText('LayerName')` → `.textContent` | Text content from named layers |

**TEXT** — get the string value directly:
```ts
const label = instance.getString('Label')
```

**VARIANT** — map Figma enum values to code values:
```ts
const variant = instance.getEnum('Variant', {
  'Primary': 'primary',
  'Secondary': 'secondary',
})

const size = instance.getEnum('Size', {
  'Small': 'sm',
  'Medium': 'md',
  'Large': 'lg',
})
```

**BOOLEAN** — simple boolean or mapped to values:
```ts
// Simple boolean
const disabled = instance.getBoolean('Disabled')

// Mapped to code values (e.g. when the code prop is an enum, not a boolean)
const size = instance.getBoolean('Show Label', { true: 'large', false: 'small' })
```

**Map Figma properties to code props where there's a valid correspondence.** Figma properties and code props don't always line up 1:1 — some Figma properties map directly (by name, or via the API methods above), others have no code equivalent. Where a mapping exists, use it; where none fits, omit the Figma property rather than invent a code prop. Never emit an attribute whose name doesn't appear in the code component's `Props` interface.

### Exhaustive variant handling

When a VARIANT property has multiple possible values, the `getEnum` mapping **must list every value** returned by `get_context_for_code_connect`. Don't omit values — an unmapped value silently returns `undefined`, producing broken output.

```ts
// WRONG — omits 'Warning', which will render as undefined
const status = instance.getEnum('Status', {
  'Success': 'success',
  'Error': 'error',
})

// CORRECT — every value is mapped
const status = instance.getEnum('Status', {
  'Success': 'success',
  'Error': 'error',
  'Warning': 'warning',
  'Info': 'info',
})
```

When **two or more VARIANT properties combine** to produce different code output, generate exhaustive conditional branches. For example, 2 variants × 2 values = 4 branches:

```ts
const type = instance.getEnum('Type', { 'Filled': 'filled', 'Outlined': 'outlined' })
const status = instance.getEnum('Status', { 'Success': 'success', 'Error': 'error' })

let colorClass
if (type === 'filled' && status === 'success') {
  colorClass = 'bg-green-500 text-white'
} else if (type === 'filled' && status === 'error') {
  colorClass = 'bg-red-500 text-white'
} else if (type === 'outlined' && status === 'success') {
  colorClass = 'bg-transparent border-green-500'
} else if (type === 'outlined' && status === 'error') {
  colorClass = 'bg-transparent border-red-500'
}
```

If the combinations produce **repetitive** output (e.g., `Size` doesn't change the snippet structure — it's just passed through as a prop), a single `getEnum` mapping per variant is sufficient — no need for cross-product branches.

**INSTANCE_SWAP** — access swappable component instances:
```ts
const icon = instance.getInstanceSwap('Icon')
let iconCode
if (icon && icon.type === 'INSTANCE') {
  iconCode = icon.executeTemplate().example
}
```

**SLOT** — `getSlot(propName)` is only valid when the Figma component property reported in Step 3 has type **`SLOT`**. Do not use `getSlot()` for **INSTANCE_SWAP** properties (those use `getInstanceSwap()`). Slots are explicit “content regions” in the component definition, not generic nested instances.

- **Signature:** `getSlot(propName: string): ResultSection[] | undefined`
```ts
// Figma property "Content" must be type SLOT in component properties
const content = instance.getSlot('Content')

export default {
  example: figma.code`<Card>${content}</Card>`,
  // ...
}
```

### Interpolation in tagged templates

When interpolating values in tagged templates, use the correct wrapping:
- **String values** (`getString`, `getEnum`, `textContent`): wrap in quotes → `variant="${variant}"`
- **Instance/section values** (`executeTemplate().example`): wrap in braces → `icon={${iconCode}}`
- **Slot sections** (`getSlot()` result — `ResultSection[] | undefined`): interpolate directly inside `` figma.code`...` `` (same shape as nested snippet sections), e.g. `` figma.code`<Select>${content}</Select>` `` — do not treat as a plain string
- **Boolean bare props**: use conditional → `${disabled ? 'disabled' : ''}`

### Finding descendant layers

When you need to access children that aren't exposed as component properties:

| Method | Use when |
|---|---|
| `instance.getInstanceSwap('PropName')` | Figma property type is **INSTANCE_SWAP** (fixed swapped instance) |
| `instance.getSlot('PropName')` | Figma property type is **SLOT** (freeform content region) |
| `instance.findInstance('LayerName')` | You know the child layer name (no component property) |
| `instance.findText('LayerName')` → `.textContent` | You need text content from a named text layer |
| `instance.findConnectedInstance('id')` | You know the child's Code Connect `id` |
| `instance.findConnectedInstances(fn)` | You need multiple connected children matching a filter |
| `instance.findLayers(fn)` | You need any layers (text + instances) matching a filter |

### Nested configurable instances

A component may contain child instances that are **not exposed as component properties** (no INSTANCE_SWAP) but are still **independently configurable** — they have their own variants, properties, or swap slots. These must be resolved dynamically, not hardcoded.

1. **Check whether the child already has a Code Connect template** — use `get_code_connect_suggestions` or check existing `.figma.ts` files in the project.
2. **If no template exists, create one** for the child so it renders correctly both standalone and when nested.
3. **Reference the child from the parent** using `findInstance()` or `findConnectedInstance()`, then call `executeTemplate()`.

```ts
// Parent template — the Badge child isn't a prop, but it's configurable
const badge = instance.findInstance('Status Badge')
let badgeCode
if (badge && badge.type === 'INSTANCE') {
  badgeCode = badge.executeTemplate().example
}

export default {
  example: figma.code`<Card>${badgeCode}</Card>`,
  // ...
}
```

This applies to icons, badges, labels, and any other nested instance that is configurable by itself — always connect them and render dynamically, never hardcode their content.

### Nested component example

For multi-level nested components or metadata prop passing between templates, see [advanced-patterns.md](references/advanced-patterns.md).

```ts
const icon = instance.getInstanceSwap('Icon')
let iconSnippet
if (icon && icon.type === 'INSTANCE') {
  iconSnippet = icon.executeTemplate().example
}

export default {
  example: figma.code`<Button ${iconSnippet ? figma.code`icon={${iconSnippet}}` : ''}>${label}</Button>`,
  // ...
}
```

### Conditional props

```ts
const variant = instance.getEnum('Variant', { 'Primary': 'primary', 'Secondary': 'secondary' })
const disabled = instance.getBoolean('Disabled')

export default {
  example: figma.code`
    <Button
      variant="${variant}"
      ${disabled ? 'disabled' : ''}
    >
      ${label}
    </Button>
  `,
  // ...
}
```

## Step 6: Validate

Read back the `.figma.ts` file and review it against the following:

- **Correct file type & format (check this FIRST)** — the file is `ComponentName.figma.ts` (NOT `.figma.tsx`), and its default export is a parserless template using a `` figma.code`...` `` tagged template. It must NOT use `figma.connect()` (the parser-based format). If you wrote `.figma.tsx` or `figma.connect()`, discard it and rewrite as a `.figma.ts` `figma.code` template.
- **Property coverage** — every Figma property from Step 3 should be accounted for in the template. Flag any that are missing and ask the user if they were intentionally omitted.
- **Valid, correctly typed code** — all emitted code must be valid and correctly typed against the code component's `Props` interface. Never make up component properties — if a Figma property has no corresponding code prop, omit it rather than invent one.
- **No hardcoded children** — verify that every INSTANCE_SWAP property and child component slot uses the dynamic APIs (`getInstanceSwap()`, `findInstance()`, `findConnectedInstance()`, etc.) with `executeTemplate()`. No slot should contain hardcoded component content.
- **Rules and Pitfalls** — check for the common mistakes listed below (string concatenation of template results, unnecessary `hasCodeConnect()` guards, missing `type === 'INSTANCE'` checks, etc.)
- **Interpolation wrapping** — strings (`getString`, `getEnum`, `textContent`) wrapped in quotes, instance/section values (`executeTemplate().example`) wrapped in braces, slot sections (`getSlot`) interpolated as snippet sections inside `` figma.code`...` ``, booleans using conditionals

If anything looks uncertain, consult [api.md](references/api.md) for API details and [advanced-patterns.md](references/advanced-patterns.md) for complex nesting.

## Inline Quick Reference

### `instance.*` Methods

| Method | Signature | Returns |
|---|---|---|
| `getString` | `(propName: string)` | `string` |
| `getBoolean` | `(propName: string, mapping?: { true: any, false: any })` | `boolean \| any` |
| `getEnum` | `(propName: string, mapping: { [figmaVal]: codeVal })` | `any` |
| `getInstanceSwap` | `(propName: string)` | `InstanceHandle \| null` |
| `getSlot` | `(propName: string)` | `ResultSection[] \| undefined` |
| `getPropertyValue` | `(propName: string)` | `string \| boolean` |
| `findInstance` | `(layerName: string, opts?: SelectorOptions)` | `InstanceHandle \| ErrorHandle` |
| `findText` | `(layerName: string, opts?: SelectorOptions)` | `TextHandle \| ErrorHandle` |
| `findConnectedInstance` | `(codeConnectId: string, opts?: SelectorOptions)` | `InstanceHandle \| ErrorHandle` |
| `findConnectedInstances` | `(selector: (node) => boolean, opts?: SelectorOptions)` | `InstanceHandle[]` |
| `findLayers` | `(selector: (node) => boolean, opts?: SelectorOptions)` | `(InstanceHandle \| TextHandle)[]` |

### InstanceHandle Methods

| Method | Returns |
|---|---|
| `hasCodeConnect()` | `boolean` |
| `executeTemplate()` | `{ example: ResultSection[], metadata: Metadata }` |
| `codeConnectId()` | `string \| null` |

### TextHandle Properties

| Property | Type |
|---|---|
| `.textContent` | `string` |
| `.name` | `string` |

### SelectorOptions

```ts
{ path?: string[], traverseInstances?: boolean }
```

- `traverseInstances: true` — required when the target lives inside another nested instance. Without it, `findInstance`/`findText` only search the current instance's own layers and stop at nested instance boundaries.
- `path: string[]` — disambiguates when multiple descendants share the same layer name. Lists parent layer names that must appear on the path to the target.

**Examples:**

```ts
// Layer hierarchy:
//   A > C (instance) > "mychild"
// "mychild" sits inside nested instance C, so plain findInstance returns ErrorHandle.
instance.findInstance('mychild', { traverseInstances: true })

// Layer hierarchy:
//   A > C (instance) > "mychild"
//   A > D (instance) > "mychild"
// Two "mychild" layers exist — use path to pick the one under C.
instance.findInstance('mychild', { traverseInstances: true, path: ['C'] })
```

**When to reach into a nested instance from a parent template:** only when the parent code component (from Step 4) takes the nested layer as a prop value itself (e.g. `<C show={<B />} />` — A forwards B into C). If the parent just composes C and C renders B internally, resolve C with `executeTemplate()` and let C's own template handle B — don't duplicate B's rendering at the parent level.

### Export Structure

```ts
export default {
  example: figma.code`...`,                      // Required: ResultSection[]
  id: 'component-name',                         // Required: string
  imports: ['import { X } from "..."'],          // Optional: string[]
  metadata: { nestable: true, props: {} }        // Optional
}
```

## Rules and Pitfalls

1. **Never string-concatenate template results.** `executeTemplate().example` is a `ResultSection[]` object, not a string. Using `+` or `.join()` produces `[object Object]`. Always interpolate inside tagged templates: `` figma.code`${snippet1}${snippet2}` ``

2. **Do not use `hasCodeConnect()` guards.** Call `executeTemplate()` directly on any instance after a `type === 'INSTANCE'` check. The runtime handles instances without Code Connect automatically.

   ```ts
   // WRONG — hasCodeConnect() gate drops non-CC instances
   if (icon && icon.type === 'INSTANCE' && icon.hasCodeConnect()) {
     iconCode = icon.executeTemplate().example
   }

   // CORRECT — let the runtime handle all instances
   if (icon && icon.type === 'INSTANCE') {
     iconCode = icon.executeTemplate().example
   }
   ```

3. **Check `type === 'INSTANCE'` before calling `executeTemplate()`.** `findInstance()`, `findConnectedInstance()`, and `findText()` return an `ErrorHandle` (truthy, but not a real node) on failure — not `null`. Always add a type check to avoid crashes: `if (child && child.type === 'INSTANCE') { ... }`

4. **Prefer `getInstanceSwap()` over `findInstance()`** when a component property exists for the slot. `findInstance('Star Icon')` breaks when the icon is swapped to a different name; `getInstanceSwap('Icon')` always works regardless of which instance is in the slot.

5. **Use `getSlot()` only when the Figma property type is `SLOT`.** For **INSTANCE_SWAP** props, use `getInstanceSwap()` (returns an `InstanceHandle`). `getSlot()` returns structured slot sections, not instances — never call `executeTemplate()` on its return value.

6. **Property names are case-sensitive** and must exactly match what `get_context_for_code_connect` returns.

7. **Handle multiple template arrays correctly.** When iterating over children, set each result in a separate variable and interpolate them individually — do not use `.map().join()`:
   ```ts
   // Wrong:
   items.map(n => n.executeTemplate().example).join('\n')

   // Correct — use separate variables:
   const child1 = items[0]?.executeTemplate().example
   const child2 = items[1]?.executeTemplate().example
   export default { example: figma.code`${child1}${child2}` }
   ```

7. **Never hardcode slot or children content.** Always resolve child instances dynamically — use `getInstanceSwap()` for INSTANCE_SWAP properties, `findInstance()`/`findConnectedInstance()` for direct children — and render them via `executeTemplate()`. Never construct JSX from a layer name (e.g., `<StarIcon />`) or guess import paths. If an instance has no Code Connect, omit it — do not add a hardcoded fallback.

   ```ts
   // WRONG — hardcodes the icon from its layer name
   example: figma.code`<Button icon={<StarIcon />}>Submit</Button>`

   // CORRECT — resolves dynamically, works for any swapped icon
   const icon = instance.findInstance('Icon')
   let iconCode
   if (icon && icon.type === 'INSTANCE') {
     iconCode = icon.executeTemplate().example
   }
   example: figma.code`<Button${iconCode ? figma.code` icon={${iconCode}}` : ''}>...</Button>`
   ```

8. **Attempt to represent every Figma property via a code prop.** The code component's `Props` interface (from Step 4) is the authoritative list of attribute names. For each Figma property, figure out the right way to represent it using the API methods from Step 5 — direct name match, value transformation, or whatever fits. If no code prop fits at all, omit it — don't invent a prop name.

## Complete Worked Example

Given URL: `https://figma.com/design/abc123/MyFile?node-id=42-100`

**Step 1:** Parse the URL.
- `fileKey` = `abc123`
- `nodeId` = `42-100` → `42:100`

**Step 2:** Call `get_code_connect_suggestions` with `fileKey: "abc123"`, `nodeId: "42:100"`, `excludeMappingPrompt: true`.
Response returns one component with `mainComponentNodeId: "42:100"`. If the response were empty, stop and inform the user. If multiple components were returned, repeat Steps 3–6 for each.

**Step 3:** Call `get_context_for_code_connect` with `fileKey: "abc123"`, `nodeId: "42:100"` (from Step 2), `clientFrameworks: ["react"]`, `clientLanguages: ["typescript"]`.

Response includes properties:
- Label (TEXT)
- Variant (VARIANT): Primary, Secondary
- Size (VARIANT): Small, Medium, Large
- Disabled (BOOLEAN)
- Has Icon (BOOLEAN)
- Icon (INSTANCE_SWAP)

**Step 4:** Search codebase → find `Button` component. Read its source to confirm props: `variant`, `size`, `disabled`, `icon`, `children`. Import path: `"primitives"`.

**Step 5:** Create `src/figma/primitives/Button.figma.ts`:

```ts
// url=https://figma.com/design/abc123/MyFile?node-id=42-100
// source=src/components/Button.tsx
// component=Button
import figma from 'figma'
const instance = figma.selectedInstance

const label = instance.getString('Label')
const variant = instance.getEnum('Variant', {
  'Primary': 'primary',
  'Secondary': 'secondary',
})
const size = instance.getEnum('Size', {
  'Small': 'sm',
  'Medium': 'md',
  'Large': 'lg',
})
const disabled = instance.getBoolean('Disabled')
const hasIcon = instance.getBoolean('Has Icon')
const icon = hasIcon ? instance.getInstanceSwap('Icon') : null
let iconCode
if (icon && icon.type === 'INSTANCE') {
  iconCode = icon.executeTemplate().example
}

export default {
  example: figma.code`
    <Button
      variant="${variant}"
      size="${size}"
      ${disabled ? 'disabled' : ''}
      ${iconCode ? figma.code`icon={${iconCode}}` : ''}
    >
      ${label}
    </Button>
  `,
  imports: ['import { Button } from "primitives"'],
  id: 'button',
  metadata: { nestable: true }
}
```

**Step 6:** Read back file to verify syntax.

## Additional Reference

For advanced patterns (multi-level nested components, `findConnectedInstances` filtering, metadata prop passing between parent/child templates):

- [api.md](references/api.md) — Full Code Connect API reference
- [advanced-patterns.md](references/advanced-patterns.md) — Advanced nesting, metadata props, and descendant patterns
