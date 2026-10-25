> Part of the [figma-generate-library skill](../SKILL.md).

# Naming Conventions Reference

This reference documents every naming convention used in the figma-generate-library workflow. Cover all naming decisions in order: variables, components, pages, variants, styles, separators, status indicators. The last section explains when to match an existing file's conventions vs. using the defaults here.

---

## 1. Variable Naming

### Slash hierarchy (the universal pattern)

All Figma variables use slash-separated paths. The slash creates visual grouping in the Variables panel and maps directly to the token hierarchy in code.

```
{category}/{subcategory}/{role}
```

Real examples from Simple DS and Material 3:

```
color/bg/primary
color/bg/secondary
color/text/primary
color/text/muted
color/border/default
color/border/focus
color/feedback/error
color/feedback/success
spacing/xs
spacing/sm
spacing/md
spacing/lg
spacing/xl
spacing/2xl
radius/none
radius/sm
radius/md
radius/lg
radius/full
typography/body/font-size
typography/body/line-height
typography/heading/font-size
typography/heading/font-weight
```

### Primitives collection

Primitive variables hold raw values and are **not** exposed to consumers (scope = `[]`). They use a flat `{family}/{step}` format matching the color scale convention from Simple DS:

```
blue/50
blue/100
blue/200
...
blue/900
gray/50
gray/100
...
gray/900
red/500
green/500
```

Step numbers follow the convention of the target codebase. If the codebase uses `100–900`, use that. If it uses `50–950`, use that. If there is no codebase convention, use `100–900` in increments of 100.

### Semantic collection

Semantic variables alias primitives. They use the role-based `{category}/{role}` or `{category}/{subcategory}/{role}` pattern:

```
color/bg/primary         → alias: primitives/white (light), primitives/gray/900 (dark)
color/bg/secondary       → alias: primitives/gray/100 (light), primitives/gray/800 (dark)
color/text/primary       → alias: primitives/gray/900 (light), primitives/white (dark)
color/text/secondary     → alias: primitives/gray/600 (light), primitives/gray/400 (dark)
color/border/default     → alias: primitives/gray/200 (light), primitives/gray/700 (dark)
```

**Rule:** Semantic variables must never hold raw hex values — they always alias a primitive. If you need a new color value, create the primitive first, then create the semantic alias.

### Casing

**Default:** Use **lowercase** with forward slashes: `color/bg/primary`, `spacing/2xl`.

**When to deviate:**
- If the existing file uses PascalCase (e.g., Material 3 uses `Schemes/Primary`) — match it.
- If the design team prefers PascalCase for readability in the Variables panel — acceptable as long as the code syntax is separately defined and uses the platform-correct case.
- Mode names can use spaces and mixed case (e.g., `SDS Light`, `Mode 1 → Light`) — these are labels, not identifiers.

**Never:** camelCase inside variable names (`colorBgPrimary` as a Figma name is wrong — that belongs in Android code syntax only). Never use spaces inside a path segment: `color/bg primary` is wrong; `color/bg/primary` is correct.

**Key distinction:** The casing rule applies to *Figma variable names*. Code syntax names follow *platform conventions* regardless of the Figma name case — see §9 for the full picture.

---

## 2. Component Naming

### Main components: PascalCase, no prefix

Published components intended for library consumers use plain PascalCase names:

```
Button
Input
Checkbox
Toggle
Avatar
Badge
Card
Dialog
Tooltip
Banner
```

Do not use a namespace prefix for public components (e.g., do not name them `DS/Button` or `sds-Button`). Slashes in component names create nested grouping in the Assets panel, which is correct for sub-components but not for top-level public components.

### Sub-components: underscore prefix + slash namespace

Internal sub-components that are NOT meant for library consumers use the `_` prefix. This hides them from the Assets panel by default and signals to other designers that they should not be used directly.

```
_Button/Slot           (internal icon slot for Button)
_Input/Indicator       (internal state indicator for Input)
_Badge/Dot             (internal dot sub-component of Badge)
_Parts/Avatar.Status   (UI3 pattern: _Parts/{ParentName}.{SubPart})
_Slider/Handle         (UI3 pattern: _{ParentName}/{SubPart})
```

Pattern rules:
- Use `_` prefix for ALL internal sub-components — no exceptions.
- Use slash namespacing to group sub-components under their parent: `_Button/IconSlot`.
- For sub-components shared by multiple parents, use `_Parts/{ComponentName}.{SubPart}`.

### Private documentation components

Components used only for internal documentation (not for production use) use the `.` prefix:

```
.ExampleCard
.GuidelineHeader
.DemoFrame
```

This hides them from consumers while keeping them accessible on the canvas.

---

## 3. Page Naming

Five reference design systems use three distinct naming patterns. Choose one pattern and apply it consistently across all pages in the file.

### Pattern 1: Plain names (Simple DS, Material 3, Polaris)

The most common pattern. Clean, readable, no decoration.

```
Cover
---
Foundations
Icons
---
Accordion
Avatars
Buttons
Cards
Dialog
Inputs
Menu
---
Utilities
Component Playground
```

Use this pattern when starting from scratch or when the target file already uses this style.

### Pattern 2: Emoji prefix + status (UI3 Library)

The most expressive pattern. The page name encodes asset type, design status, and code readiness.

Anatomy: `[Asset Type Emoji] [Optional FPL Label] [Status Circle] Component Name [Code Status Bracket]`

| Segment | Values |
|---------|--------|
| Asset type | Component pages use the C-flag emoji; pattern pages use the P-flag emoji |
| Design status | Green circle = Ready, Yellow circle = WIP, Red circle = Do not use |
| Code status | (none) = Ready in code, `[beta]` = Beta, `[future]` = Not yet built |

Examples:
```
Overview
Status Key
---
FPL COMPONENTS (go/fpl)
[C-flag] FPL [Green] Buttons
[C-flag] FPL [Green] Inputs
[C-flag] FPL [Yellow] Popovers [future]
---
UI3 COMPONENTS
[C-flag] [Green] Comments
---
PATTERNS
[P-flag] [Green] Editor / Layers
---
[Book] Cover
[Headstone] Deprecated
```

Use this pattern only when building a large, multi-team design system where lifecycle tracking is needed, or when the target file already uses it.

### Pattern 3: Emoji prefix (Shop Minis)

A lighter version of the UI3 pattern without status circles.

```
📔 Cover
ℹ️ About
🚀 Getting started
——— THEME ———
Color
Typography
Spacing
——— COMPONENTS ———
Button
Input
Card
```

Use this pattern when the target file already uses emoji prefixes but does not need lifecycle tracking.

### Universal rules (all patterns)

- **Cover** is always first.
- **Separator pages** come before and after each logical section.
- **Foundation/token pages** always come before component pages.
- **Utility and internal pages** always come last.
- Pick one convention and do not mix patterns within a file.

---

## 4. Variant Naming

### Property=Value format

All component variant properties and their values use `Property=Value` format in the Figma component set:

```
Size=Small, Style=Primary, State=Default
Size=Medium, Style=Secondary, State=Hover
Size=Large, Style=Ghost, State=Disabled
```

Actual property names match code prop names where possible:

| Figma Property | Code Prop Equivalent |
|---------------|---------------------|
| `Size` | `size` |
| `Style` / `Variant` | `variant` |
| `State` | Typically controlled by `:hover`, `:focus`, `:disabled` in CSS, but `state` in some systems |
| `Type` | `type` |
| `Disabled` | `disabled` (boolean) |
| `Icon` | `icon` (boolean or instance swap) |

### Property value casing

Property values use **Title Case** in Figma (to be readable in the Variants panel), mapping to lowercase in code:

| Figma value | Code value |
|-------------|-----------|
| `Small` | `"small"` / `"sm"` |
| `Medium` | `"medium"` / `"md"` |
| `Large` | `"large"` / `"lg"` |
| `Primary` | `"primary"` |
| `Disabled` | `disabled` (boolean prop) |
| `Default` | *(typically the absent/unset case)* |

### Boolean properties

Boolean component properties in Figma use `true` / `false` as values (Figma's native boolean), not `Yes` / `No` or `On` / `Off`.

---

## 5. Style Naming (Text and Effect Styles)

### Text styles: category/name

```
Display/Large
Display/Medium
Display/Small
Heading/1
Heading/2
Heading/3
Body/Large
Body/Medium
Body/Small
Label/Large
Label/Small
Code/Inline
```

The category segment maps to the typographic role. Use the same category names as the codebase's typography scale where possible.

### Effect styles (shadows): category/name

```
Shadow/None
Shadow/Subtle
Shadow/Medium
Shadow/Strong
Shadow/Overlay
Elevation/0
Elevation/1
Elevation/2
Elevation/3
Elevation/4
Elevation/5
```

Use `Shadow/` for named semantic shadows. Use `Elevation/N` for Material Design-style numbered elevation levels.

---

## 6. Separator Pages

Separator pages are empty pages whose sole purpose is to create visual breaks in the Figma page panel. Two conventions:

| Convention | Example | Used by |
|------------|---------|---------|
| Three dashes | `---` | Simple DS, UI3, Polaris, Material 3 |
| Decorated text | `——— COMPONENTS ———` | Shop Minis |

The three-dash convention (`---`) is the most common and the default for new files. Use it unless the target file uses the decorated-text style.

**Where to place separators:**

```
Cover
---                    ← after cover
Foundations
Icons
---                    ← before components
[component pages]
---                    ← before utilities
Utilities
```

---

## 7. Status Indicators (UI3 Emoji System)

The UI3 Library uses colored circle emojis in page names to communicate design readiness at a glance. This system is optional but powerful for large teams.

| Emoji | Meaning | When to use |
|-------|---------|-------------|
| Green circle | Ready / Approved | Design is stable, reviewed, and safe to use |
| Yellow circle | WIP / In Progress | Design is being actively worked on, may change |
| Red circle | Do not use | Not ready, do not reference; may be deprecated |

Code readiness is communicated via brackets appended to the component name:

| Bracket | Meaning |
|---------|---------|
| (none) | Component is implemented in code and stable |
| `[beta]` | Component is in code but not yet stable (~3 weeks from ready) |
| `[future]` | Not yet implemented in code |

**Documentation status (within component pages):**

If building a UI3-style system, each documentation frame gets a status banner with one of these labels:

- `APPROVED` — fully vetted
- `READY FOR REVIEW` — awaiting sign-off
- `WORK IN PROGRESS` — actively being designed
- `NEEDS UPDATE` — outdated, requires revision
- `DO NOT REFERENCE` — should not be used

This system is only recommended for large, multi-team systems where lifecycle tracking provides real value. For smaller systems, skip the emoji status indicators and use plain page names.

---

## 8. When to Match Existing vs. Use Defaults

**Always inspect before naming anything.** Run `get_metadata` or `inspectFileStructure` to discover existing conventions before creating any pages or variables.

### Match the existing file when:

- The file already has pages with a consistent naming pattern (emoji prefixes, separator style, casing).
- The file already has variable collections with an established naming scheme.
- The file was started by a design team and carries intentional decisions.
- Any existing component names use a specific pattern (PascalCase, kebab-case, namespace prefixes).

### Use the defaults from this document when:

- Starting a brand-new Figma file with no existing content.
- The existing conventions are inconsistent (mix of styles = no convention to match).
- The user explicitly asks for a fresh design system following best practices.

### When code and Figma disagree:

If the codebase uses `button-primary` but Figma has a component named `Button`, do not rename the Figma component. Instead:
- Keep the Figma name as `Button` (PascalCase, human-readable).
- Set variable code syntax to match the exact CSS token name from the codebase.
- Set Code Connect source path to the actual code file and use the exact code component name.

**The rule:** Figma names are for designers; code syntax and Code Connect source paths carry the exact code identifiers. These two identity systems operate in parallel.

---

## 9. Figma Variable Names vs Code Names — The Full Picture

This is one of the most misunderstood areas. Figma names and code names follow **different conventions on purpose** — they serve different audiences and live in different environments.

### Why they differ

| | Figma variable name | Code syntax (WEB) |
|---|---|---|
| **Audience** | Designers in the Variables panel | Developers in CSS/Swift/Kotlin |
| **Separator** | `/` (slash) — creates visual grouping in Figma UI | `-` (hyphen) — required by CSS custom property syntax |
| **Case** | lowercase (or PascalCase for display — see below) | kebab-case for CSS; camelCase for JS/Android |
| **Depth** | 2–4 levels | Flat for CSS; dot-notation for JS |
| **Namespace** | Implicit (by collection) | Explicit prefix (`--p-`, `--md-`, `--cds-`) |

### The transformation

```
Figma variable name              Code syntax (WEB)
──────────────────               ─────────────────
color/bg/primary          →      var(--color-bg-primary)
spacing/xs                →      var(--spacing-xs)
radius/md                 →      var(--radius-md)
typography/body/font-size →      var(--typography-body-font-size)

Pattern: replace "/" with "-", wrap in var(--)

**CRITICAL: The `var()` wrapper is REQUIRED for WEB code syntax.** Figma expects the full CSS function syntax — not just the property name. If you set `--color-bg-primary` (without `var()`), Dev Mode will show raw hex values instead of the variable reference. Always set `var(--color-bg-primary)`.
```

```
Figma variable name              Code syntax (ANDROID)
──────────────────               ─────────────────────
color/bg/primary          →      colorBgPrimary
spacing/xs                →      spacingXs
radius/md                 →      radiusMd

Pattern: replace "/" with "", capitalize each word after first
```

```
Figma variable name              Code syntax (iOS)
──────────────────               ─────────────────
color/bg/primary          →      Color.bgPrimary
spacing/xs                →      Spacing.xs
radius/md                 →      Radius.md

Pattern: first segment becomes class name, remainder becomes property (camelCase)
```

### Real-world examples from the 5 reference files

| File | Figma variable name | WEB code syntax | ANDROID code syntax |
|------|--------------------|-----------------|--------------------|
| Simple DS | `color/bg/primary` | `var(--color-bg-primary)` | `colorBgPrimary` |
| Simple DS | `spacing/sm` | `var(--spacing-sm)` | `spacingSm` |
| Material 3 | `Schemes/Primary` | `var(--md-sys-color-primary)` | `colorPrimary` |
| Material 3 | `Corner/Extra-small` | `var(--md-sys-shape-corner-extra-small)` | `shapeCornerExtraSmall` |
| Polaris | `color/bg/surface` | `var(--p-color-bg-surface)` | — |

**Key observation from Material 3:** The Figma name `Schemes/Primary` uses PascalCase with a space, but the WEB code syntax is `var(--md-sys-color-primary)` — entirely kebab-case with a vendor prefix `md-sys-`. The Figma name and the code syntax bear almost no resemblance. This is intentional and common in mature design systems.

### Casing in Figma: lowercase is default, PascalCase is valid for display

The guideline to use lowercase is a default, not a universal rule. Evidence from real files:

| File | Figma case | Code output case | Why |
|------|-----------|------------------|-----|
| Simple DS | `color/bg/primary` (lowercase) | `var(--color-bg-primary)` | Direct mapping — simple |
| Material 3 | `Schemes/Primary` (PascalCase) | `var(--md-sys-color-primary)` | PascalCase reads better in Variables panel; code name is independently defined |
| Polaris | `color/bg/surface` (lowercase) | `var(--p-color-bg-surface)` | Direct mapping with vendor prefix |

**Rule:** Use lowercase when the Figma name will map directly to the CSS name. Use PascalCase (or match existing file) when the design system has human-readable variable names that are distinct from the technical code names.

### When the codebase doesn't use CSS custom properties

Some JavaScript-first systems (Chakra, Ant Design, MUI) don't use CSS `var(--...)` at all. Their tokens live in JS theme objects:

```
Chakra:    colors.gray[500]         →  JS: theme.colors.gray[500]
Ant:       colorPrimary             →  JS: token.colorPrimary
MUI:       palette.primary.main     →  JS: theme.palette.primary.main
```

In these cases, set WEB code syntax to the JS property path rather than a CSS variable:
```javascript
// For a JS-object-based system like Chakra:
v.setVariableCodeSyntax('WEB', 'colors.gray.500');

// For Ant Design:
v.setVariableCodeSyntax('WEB', 'colorPrimary');
```

### Hierarchy depth: match the codebase

The number of slash levels should mirror the codebase's nesting depth:

| Codebase pattern | Figma depth | Example |
|-----------------|------------|---------|
| `--primary` (flat) | 1–2 levels | `color/primary` |
| `--color-bg-surface` (3-part) | 3 levels | `color/bg/surface` |
| `--md-sys-color-primary` (vendor + 3-part) | 3 levels (vendor prefix goes in code syntax only) | `color/primary` |
| `theme.palette.primary.main` (4-part) | 3–4 levels | `color/palette/primary/main` |

**Important:** Vendor prefixes (`--p-`, `--md-sys-`, `--cds-`) belong in the **code syntax**, not the Figma variable name. The Figma name `color/bg/surface` + code syntax `var(--p-color-bg-surface)` is the correct pattern.

### Action at discovery time

During Phase 0 discovery, capture both sides of the mapping explicitly:

```
For each token found in the codebase:
  CSS variable:   --sds-color-background-brand-default
  Figma name:     color/bg/brand/default        (slash hierarchy, no vendor prefix)
  WEB syntax:     var(--sds-color-background-brand-default)  (exact CSS name)
  ANDROID syntax: sdsColorBackgroundBrandDefault  (camelCase)
  iOS syntax:     Color.backgroundBrandDefault    (dot-notation)
```

Store this mapping in the state ledger. Use it when calling `setVariableCodeSyntax` in Phase 1. Never derive the code syntax from the Figma name if you have the original CSS variable name — always use the original.
