> Part of the [figma-generate-library skill](../SKILL.md).

# Discovery Phase Reference

This document covers everything needed for Phase 0 of a design system build: analyzing the codebase for tokens, inspecting the Figma file for existing conventions, searching subscribed libraries, building the plan, and resolving conflicts before any write operations begin.

---

## 1. Codebase Analysis — Finding Token Sources

### Search Priority Order

Look for token sources in this order. Stop as soon as you find a definitive source; multiple formats can coexist:

1. Design token files: `*.tokens.json`, `tokens/*.json`, `src/tokens/**`
2. CSS variable files: `variables.css`, `tokens.css`, `theme.css`, `global.css`
3. Tailwind config: `tailwind.config.js`, `tailwind.config.ts`
4. CSS-in-JS theme objects: `theme.ts`, `createTheme`, `ThemeProvider`
5. Platform-specific: iOS Asset catalogs (`.xcassets`), Android `themes.xml`, `colors.xml`

### CSS Custom Properties (Most Common for Web)

**What to search for:**

```
:root { ... }
@theme { ... }          ← Tailwind v4
--color-*, --spacing-*, --radius-*, --shadow-*, --font-*
```

**Pattern:** `/--[\w-]+:\s*[^;]+/g`

**Common file locations:** `src/styles/tokens.css`, `src/styles/variables.css`, `src/theme/*.css`

**Extraction and naming translation:**

| CSS Property | Figma Variable Name | Figma Type | WEB Code Syntax |
|---|---|---|---|
| `--color-bg-primary: #fff` | `color/bg/primary` | COLOR | `var(--color-bg-primary)` |
| `--color-text-secondary: #757575` | `color/text/secondary` | COLOR | `var(--color-text-secondary)` |
| `--spacing-sm: 8px` | `spacing/sm` | FLOAT | `var(--spacing-sm)` |
| `--radius-md: 8px` | `radius/md` | FLOAT | `var(--radius-md)` |
| `--font-body: "Inter"` | `typography/body/font-family` | STRING | `var(--font-body)` |

**Naming rule:** Replace hyphens with slashes at category boundaries. Keep hyphens within the final path segment: `--color-bg-primary` → `color/bg/primary`, but `--color-bg-primary-hover` → `color/bg/primary-hover`.

**Always store the original CSS variable name** as the code syntax value — never derive it from the Figma variable name. If the codebase uses `--sds-color-background-brand-default`, use exactly that string in `setVariableCodeSyntax('WEB', '--sds-color-background-brand-default')`.

### Tailwind Configuration

**What to look for in `tailwind.config.js` or `tailwind.config.ts`:**

```javascript
// theme.extend.colors → Figma color variables
{ primary: { DEFAULT: '#3366FF', light: '#6699FF', dark: '#0033CC' } }
// → color/primary/default, color/primary/light, color/primary/dark

// theme.extend.spacing → Figma FLOAT variables
{ 'xs': '4px', 'sm': '8px', 'md': '16px' }
// → spacing/xs = 4, spacing/sm = 8, spacing/md = 16

// theme.extend.borderRadius → Figma FLOAT variables
{ 'sm': '4px', 'md': '8px', 'lg': '16px' }
// → radius/sm = 4, radius/md = 8, radius/lg = 16
```

Tailwind utility class names (`bg-blue-500`, `p-4`) are not tokens — extract values from the config object, not the class names.

### Design Token Community Group (DTCG) Format

**Pattern:** `*.tokens.json` or `tokens/*.json`. Find source files, not generated outputs from Style Dictionary or Tokens Studio.

```json
{
  "color": {
    "bg": {
      "primary": { "$type": "color", "$value": "#ffffff" },
      "secondary": { "$type": "color", "$value": "#f5f5f5" }
    }
  },
  "spacing": {
    "sm": { "$type": "dimension", "$value": "8px" }
  }
}
```

Nested keys map to slash-separated Figma names: `color.bg.primary` → `color/bg/primary`.

### CSS-in-JS / Theme Objects

**What to search for:** `createTheme`, `ThemeProvider`, `theme = {}`, styled-components, Emotion, Stitches, vanilla-extract

```typescript
// theme.colors.bg.primary → Figma variable: color/bg/primary
// theme.spacing.sm        → Figma variable: spacing/sm
// Multiple theme objects (lightTheme, darkTheme) → modes in the same collection
```

### iOS Token Sources

```swift
// Asset catalog colors in .xcassets/Colors.xcassets
// extension Color { static let bgPrimary = Color("bg-primary") }
// Look for traitCollection.userInterfaceStyle for dark mode detection
```

### Android Token Sources

```kotlin
// res/values/colors.xml  <color name="primary">#3366FF</color>
// res/values-night/colors.xml  (dark mode overrides)
// MaterialTheme.colorScheme.primary in Compose
// val Primary = Color(0xFF3366FF)
```

### Detecting Dark Mode

| Platform | Signal |
|---|---|
| Web (CSS) | `@media (prefers-color-scheme: dark)`, `.dark { }`, `[data-theme="dark"]` |
| Web (Tailwind) | `darkMode: 'class'` or `darkMode: 'media'` in config |
| Web (JS) | Separate `darkTheme` object alongside `lightTheme` |
| iOS | `Color(uiColor:)` with `traitCollection.userInterfaceStyle`, dual-appearance asset catalog |
| Android | `themes.xml` with `Theme.*.Night`, `isSystemInDarkTheme()` in Compose, `values-night/` folder |

**Figma mapping:** If dark mode exists → minimum 2 modes (Light/Dark) in the semantic color collection. Primitive collections stay single-mode.

### Shadow/Elevation Extraction

Shadows cannot be Figma variables — they become **Effect Styles**.

```css
/* Look for: box-shadow, --shadow-* */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.10);
--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.10);
```

CSS `0 4px 6px -1px rgba(0,0,0,0.1)` → Figma:
```
{ type: "DROP_SHADOW", offset: {x:0, y:4}, radius: 6, spread: -1, color: {r:0, g:0, b:0, a:0.1} }
```

### Typography Extraction

| Code token | Maps to |
|---|---|
| `font-size: 16px` | FLOAT variable (scope `FONT_SIZE`) or Text Style `fontSize` |
| `line-height: 1.5` | Text Style `lineHeight: {value: 24, unit: "PIXELS"}` |
| `font-weight: 600` | STRING variable (scope `FONT_STYLE`, holds a font-specific style name like `"Regular"` — discover via `listAvailableFontsAsync()`) or Text Style `fontName.style` |
| `letter-spacing: -0.02em` | Text Style `letterSpacing: {value: -2, unit: "PERCENT"}` |
| `font-family: "Inter"` | STRING variable (scope `FONT_FAMILY`) or Text Style `fontName.family` |

Composite text styles (all properties bundled) → Figma Text Styles. Individual properties → Figma variables with appropriate scopes.

### Component Extraction

For each component, extract:

1. **Name** → Figma component set name
2. **Union-type props** → VARIANT properties
3. **String content props** → TEXT properties
4. **Boolean props** → BOOLEAN properties (and VARIANT State when combined with interaction states)
5. **Child/slot props** → INSTANCE_SWAP properties

```typescript
// React example:
interface ButtonProps {
  size: 'sm' | 'md' | 'lg';          // → VARIANT: Size = sm|md|lg
  variant: 'primary' | 'secondary';   // → VARIANT: Style = primary|secondary
  disabled?: boolean;                  // → VARIANT: State (combine: default|hover|pressed|disabled)
  label: string;                       // → TEXT: Label
  icon?: ReactNode;                    // → INSTANCE_SWAP: Icon + BOOLEAN: Show Icon
}
// → Component Set "Button", variant count: 3 sizes × 2 styles × 4 states = 24
```

---

## 2. Figma File Inspection

Run these `use_figma` snippets during scoped discovery. All are read-only and safe to run before any mutation.

### List All Pages

```javascript
const pages = figma.root.children.map((p, i) => ({
  index: i,
  name: p.name,
  id: p.id,
  childCount: p.children.length
}));
return { pages };
```

Interpret: note page names for naming convention (are they PascalCase? sentence case?), count separator pages (`---`), identify existing component pages vs foundations pages.

### List Variable Collections With Modes

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const result = collections.map(c => ({
  id: c.id,
  name: c.name,
  modes: c.modes,                    // [{modeId, name}, ...]
  variableCount: c.variableIds.length,
  defaultModeId: c.defaultModeId
}));
return { collections: result };
```

Interpret: identify existing primitive/semantic split, note mode names (do they use "Light/Dark" or "SDS Light/SDS Dark"?), count variables to understand scope.

### List Variables in a Collection (with names, types, scopes, and sample values)

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const targetName = "Color"; // change to the collection you want to inspect
const coll = collections.find(c => c.name === targetName);
if (!coll) { return { error: `Collection "${targetName}" not found` }; }

const allVars = await figma.variables.getLocalVariablesAsync();
const vars = allVars.filter(v => v.variableCollectionId === coll.id);

const result = vars.map(v => ({
  id: v.id,
  name: v.name,
  resolvedType: v.resolvedType,
  scopes: v.scopes,
  codeSyntax: v.codeSyntax,
  // First mode value only, for a sample
  sampleValue: v.valuesByMode[coll.defaultModeId]
}));

return { collection: coll.name, variableCount: result.length, variables: result };
```

Interpret: check if variables use `ALL_SCOPES` (bad), check naming convention (slash-separated hierarchy?), check if code syntax is set, identify alias chains.

### List Component Sets with Properties

```javascript
// To inspect a specific page, switch to it first:
// await figma.setCurrentPageAsync(targetPage);
const componentSets = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET'] });
const result = componentSets.map(cs => ({
  id: cs.id,
  name: cs.name,
  variantCount: cs.children.length,
  properties: Object.entries(cs.componentPropertyDefinitions).map(([key, def]) => ({
    name: key,
    type: def.type,
    variantOptions: def.variantOptions || null,
    defaultValue: def.defaultValue
  }))
}));
return { componentSets: result, count: result.length };
```

Note: to search ALL pages, **do not iterate `figma.root.children` and `setCurrentPageAsync` inside one script.** Run a cheap discovery call first (`figma.root.children.map(p => ({id: p.id, name: p.name}))`), then in the next assistant turn emit **one `use_figma` per page in parallel** — a single message with N tool-use blocks — each setting `currentPage` once. See [figma-use → gotchas.md → Set current page once per `use_figma` call](../../figma-use/references/gotchas.md#set-current-page-once-per-use_figma-call--split-multi-page-work-into-parallel-calls).

### List All Styles

```javascript
const [textStyles, effectStyles, paintStyles] = await Promise.all([
  figma.getLocalTextStylesAsync(),
  figma.getLocalEffectStylesAsync(),
  figma.getLocalPaintStylesAsync()
]);

return {
  textStyles: textStyles.map(s => ({ id: s.id, name: s.name, fontSize: s.fontSize, fontName: s.fontName })),
  effectStyles: effectStyles.map(s => ({ id: s.id, name: s.name, effectCount: s.effects.length })),
  paintStyles: paintStyles.map(s => ({ id: s.id, name: s.name })),
  counts: { text: textStyles.length, effect: effectStyles.length, paint: paintStyles.length }
};
```

### Check Naming Conventions on an Existing Component

```javascript
// Replace with the node ID of an existing component to analyze
const node = await figma.getNodeByIdAsync("YOUR_NODE_ID");
if (!node) { return { error: "Node not found" }; }

// Check fills for variable bindings
const fillInfo = [];
if ('fills' in node && Array.isArray(node.fills)) {
  for (const fill of node.fills) {
    if (fill.type === 'SOLID' && fill.boundVariables?.color) {
      fillInfo.push({ type: 'variable_alias', id: fill.boundVariables.color.id });
    } else if (fill.type === 'SOLID') {
      fillInfo.push({ type: 'hardcoded', r: fill.color.r, g: fill.color.g, b: fill.color.b });
    }
  }
}

return {
  name: node.name,
  type: node.type,
  fills: fillInfo
};
```

---

## 3. Library Discovery and search_design_system

### Step 1: Discover available libraries with `get_libraries`

Before searching, call `get_libraries` to see what libraries the file has access to:

```
get_libraries({ fileKey: "abc123" })
// offset is optional; omit (or pass 0) for the first page
```

Returns:
- **`libraries_added_to_file`** — libraries currently subscribed (team libraries, community UI kits already enabled)
- **`libraries_available_to_add`** — community UI kits and org libraries not yet subscribed
- **`libraries_available_to_add_next_offset`** — non-null when more org libraries are available; pass it back as `offset` to fetch the next page

Each library entry includes `name`, `libraryKey`, `description`, and `source` ("team", "community", or "organization"). Use the `libraryKey` values to scope searches in the next step.

**Pagination.** Org libraries paginate in batches of 20. Community UI kits are only returned on the first page (`offset=0`), so subsequent pages contain only org libraries. If the user is looking for a specific library by name and it isn't in the current page, page further (call `get_libraries` again with `offset: libraries_available_to_add_next_offset`) or ask them to subscribe it to the file.

```
// Page 1
get_libraries({ fileKey: "abc123" })
// → { ..., libraries_available_to_add_next_offset: 20 }

// Page 2
get_libraries({ fileKey: "abc123", offset: 20 })
// → { ..., libraries_available_to_add_next_offset: 40 | null }
```

### Step 2: Search with `search_design_system`

`search_design_system` searches design libraries for the given file. Each `queries` entry names one entity type:

1. **Components** — published library components, searched by name/description via a recommendation engine (relevance-ranked, not exact match)
2. **Variables** — design tokens (colors, spacing, etc.) across subscribed libraries
3. **Styles** — paint styles, text styles, and effect styles

By default it searches all accessible libraries. Pass `includeLibraryKeys` to search within specific libraries only. This is useful when you have many libraries and want targeted results.

### Input

```
// Search all libraries
search_design_system({
  queries: [
    { entity: "component", query: "button" },
    { entity: "variable", query: "color" },
    { entity: "style", query: "heading" }
  ],
  fileKey: "abc123"            // required — your file key
})

// Search a specific library only (use libraryKey from get_libraries)
search_design_system({
  queries: [{ entity: "component", query: "button" }],
  fileKey: "abc123",
  includeLibraryKeys: ["lk-abc123..."]
})
```

### What It Returns

```json
{
  "results": [
    {
      "entity": "component",
      "query": "button",
      "components": [
        {
          "name": "Button",
          "libraryName": "Design System",
          "assetType": "component_set",
          "componentKey": "abc123def",
          "description": "Primary action button"
        }
      ]
    },
    {
      "entity": "variable",
      "query": "color",
      "variables": [
        {
          "name": "colors/primary/500",
          "variableType": "COLOR",
          "variableSetKey": "set1key",
          "key": "var1key",
          "scopes": ["FRAME_FILL", "SHAPE_FILL"],
          "variableCollectionName": "Colors"
        }
      ]
    },
    {
      "entity": "style",
      "query": "heading",
      "styles": [
        {
          "name": "Heading/H1",
          "styleType": "TEXT",
          "key": "style1key"
        }
      ]
    }
  ]
}
```

### How to Interpret Results

**Components:** The `componentKey` can be used in `use_figma` to import the component:
```javascript
const component = await figma.importComponentByKeyAsync("abc123def");
// or for component sets:
const componentSet = await figma.importComponentSetByKeyAsync("abc123def");
```

**Variables:** The `variableSetKey` is the collection key. The `key` is the variable key. Use these to understand what naming conventions are in use, and what tokens are available to alias from.

**Styles:** The `key` is usable with `figma.importStyleByKeyAsync(key)` to import into the current file.

### When to Search

- **During scoped discovery:** Search broadly for the selected inventory (`queries: [{ entity: "component", query: "button" }, { entity: "variable", query: "color" }, { entity: "variable", query: "spacing" }]`). This establishes the reuse baseline.
- **Search again only when needed:** Repeat a component search when it was outside the selected inventory, available libraries changed, or the earlier result did not resolve it. Reuse current results for in-scope components.

**Reuse decision:**

| Condition | Decision |
|---|---|
| Found component with matching variant API, same token model | Import and reuse |
| Found component but wrong variant properties or hardcoded values | Rebuild |
| Found component that matches visually but API is incompatible | Wrap: nest as instance inside a new wrapper component |

---

## 4. Building the Plan

After codebase analysis and Figma inspection, produce a mapping table and present it to the user.

### Token → Variable Mapping Table

For each token found in code, record:

| Code Token | CSS Name | Raw Value | Figma Collection | Figma Variable Name | Figma Type | Mode(s) |
|---|---|---|---|---|---|---|
| `theme.colors.blue[500]` | `--color-blue-500` | `#3B82F6` | Primitives | `blue/500` | COLOR | Value |
| `theme.colors.bg.primary` | `--color-bg-primary` | (light: blue/50, dark: gray/900) | Color | `color/bg/primary` | COLOR | Light, Dark |
| `theme.spacing.sm` | `--spacing-sm` | `8px` | Spacing | `spacing/sm` | FLOAT | Value |
| `theme.radii.md` | `--radius-md` | `8px` | Spacing | `radius/md` | FLOAT | Value |
| `theme.shadows.md` | `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | — | — | Effect Style | — |

### Component → Component Set Mapping Table

| Code Component | Props → Variant Axes | Variant Count | Figma Page | Reuse? |
|---|---|---|---|---|
| `Button` | size (sm/md/lg) × variant (primary/secondary) × state (default/hover/disabled) | 18 | Buttons | Search first |
| `Avatar` | size (sm/md/lg) × type (image/initials/icon) | 9 | Avatars | Search first |

### Gap Identification

Compare what was found in code vs what already exists in Figma:

- **New:** tokens or components that exist in code but not in Figma → create
- **Existing:** tokens or components already in Figma with matching names → verify scope/code-syntax, skip or update
- **Conflict:** same name, different value → escalate to user (see section 5)
- **Figma-only:** exists in Figma but not in code → flag for user, likely skip

### User-Facing Discovery Summary Template

Present one concise scope and acceptance summary, then continue into the selected workflow path. Ask the user only when an unresolved conflict requires a decision.

```
Here's what I found and what I plan to build:

CODEBASE ANALYSIS
  Colors: {N} primitives ({families}), {M} semantic tokens ({light/dark if applicable})
  Spacing: {N} tokens ({range})
  Typography: {N} text styles, {M} individual scale tokens
  Shadows: {N} levels → will become Effect Styles
  Components: {list of component names}

EXISTING FIGMA FILE
  Collections: {N} existing collections
  Variables: {M} existing variables
  Styles: {K} text, {L} effect, {J} paint styles
  Components: {list}

PLAN
  New collections: {list with mode counts}
  New variables: ~{N} ({breakdown by collection})
  New styles: {N} text, {M} effect
  New components: {list}
  Reusable library results for the selected inventory: {list}

GAPS / CONFLICTS NEEDING DECISIONS
  ⚠ {conflict description} — Code says X, Figma already has Y. Which wins?

WHAT I WON'T BUILD (and why)
  - {item}: already exists in Figma with matching conventions
  - {item}: not supported as a Figma variable (e.g. z-index)
```

---

## 5. Conflict Resolution — When Code and Figma Disagree

When the same token/component exists in both code and Figma but with different values, names, or structures, **always ask the user**. Never silently pick one.

### Decision Framework

| Scenario | Ask the user |
|---|---|
| Same CSS name, different hex value (e.g., `--color-accent` is `#3366FF` in code but `#5B7FFF` in Figma) | "Code says `#3366FF`, Figma currently has `#5B7FFF` for `color/accent/default`. Which is correct?" |
| Same component name, different variant axes (code has `size: sm/md/lg`, Figma has `Size: Small/Large`) | "Code uses 3 sizes (sm/md/lg) but Figma has 2 (Small/Large). Should I add Medium, or rename to match code?" |
| Code has a semantic token with no primitive layer; Figma already has a fully-layered system | "The codebase uses a flat single-layer token model. The Figma file uses a primitive/semantic split. Should I match the Figma architecture or the code architecture?" |
| Figma variable exists but has `ALL_SCOPES` (incorrect per best practice) | "I found `color/bg/primary` already exists but it uses ALL_SCOPES. I recommend changing it to `FRAME_FILL, SHAPE_FILL`. May I update the scope?" |
| Code uses camelCase (`backgroundColor`), Figma uses slash-separated (`color/bg/default`) | "The codebase uses camelCase naming. The Figma file uses slash-separated hierarchy. For new variables, should I use slash-separated (Figma standard) and map via code syntax?" |

### Code Wins

Default to code as the source of truth for:
- Hex values (code is the live production value)
- Token naming (the CSS variable names become code syntax)
- Mode values (light/dark split comes from code)

### Figma Wins

Default to Figma as the source of truth for:
- Collection architecture (if a well-structured system already exists, extend it rather than replace it)
- Variable naming hierarchy (if designers are already using the system with specific names)
- Page structure (match the existing page organization pattern)

### Neither: Negotiate

When neither is clearly correct, propose a resolution and ask:
> "I'd suggest [option]. This way both the code token name and the Figma naming convention are preserved. Does that work?"
