> Part of the [figma-generate-library skill](../SKILL.md).

# Token Creation Reference

This document covers Phase 1: creating variable collections, modes, primitives, semantic aliases, scopes, code syntax, styles, and validation. All code is copy-paste ready for `use_figma`.

---

## 1. Collection Architecture

Choose the pattern that matches your token count and complexity:

### Simple Pattern (< 50 tokens)

One collection, 2 modes. Appropriate for small projects or brand kits.

```
Collection: "Tokens"    modes: ["Light", "Dark"]
  color/bg/primary → Light: #FFFFFF, Dark: #1A1A1A
  spacing/sm = 8
```

### Standard Pattern (50–200 tokens) — Recommended Starting Point

Separate primitives from semantics. The real-world reference is Figma's Simple Design System (SDS): 7 collections, 368 variables, light/dark modes on semantic colors, single-mode primitives.

```
Collection: "Primitives"    modes: ["Value"]       ← raw hex values, no modes
  blue/500 = #3B82F6
  gray/900 = #111827
  white/1000 = #FFFFFF

Collection: "Color"         modes: ["Light", "Dark"] ← aliases to Primitives
  color/bg/primary → Light: alias Primitives/white/1000, Dark: alias Primitives/gray/900
  color/text/primary → Light: alias Primitives/gray/900, Dark: alias Primitives/white/1000

Collection: "Spacing"       modes: ["Value"]
  spacing/xs = 4, spacing/sm = 8, spacing/md = 16, spacing/lg = 24, spacing/xl = 32

Collection: "Typography Primitives"  modes: ["Value"]
  family/sans = "Inter", scale/01 = 12, scale/02 = 14, scale/03 = 16, weight/regular = 400

Collection: "Typography"    modes: ["Value"]        ← aliases to Typography Primitives
  body/font-family → alias family/sans
  body/size-md → alias scale/03
```

### Advanced Pattern (200+ tokens) — M3 Model

Multiple semantic collections, 4–8 modes. Use when you need light/dark × contrast × brand or responsive breakpoints.

```
Collection: "M3"           modes: ["Light", "Dark", "Light High Contrast", "Dark High Contrast", ...]
Collection: "Typeface"     modes: ["Baseline", "Wireframe"]
Collection: "Typescale"    modes: ["Value"]  ← aliases into Typeface
Collection: "Shape"        modes: ["Value"]
```

Key insight from M3: ALL 196 semantic color variables live in a SINGLE collection with 8 modes. Switching a frame's mode once updates every color simultaneously.

---

## 2. Creating Collections + Modes

### Creating a Primitives Collection

```javascript
// Create the collection
const primColl = figma.variables.createVariableCollection("Primitives");

// Rename the default "Mode 1" to "Value"
primColl.renameMode(primColl.modes[0].modeId, "Value");
const valueMode = primColl.modes[0].modeId;

return {
  collectionId: primColl.id,
  modeId: valueMode,
  name: primColl.name
};
```

### Creating a Semantic Color Collection with Light/Dark Modes

```javascript
const colorColl = figma.variables.createVariableCollection("Color");

// Rename default "Mode 1" to "Light"
colorColl.renameMode(colorColl.modes[0].modeId, "Light");
const lightModeId = colorColl.modes[0].modeId;

// Add "Dark" mode — requires Professional plan or higher
// Throws "in addMode: Limited to N modes only" on Starter plan
const darkModeId = colorColl.addMode("Dark");


return {
  collectionId: colorColl.id,
  lightModeId,
  darkModeId
};
```

**Mode plan limits:** Starter = 1 mode, Professional = 4 modes, Organization/Enterprise = 40 modes. If `addMode` throws, the file is on a Starter plan — tell the user and ask how to proceed.

### Creating a Spacing Collection (single mode)

```javascript
const spacingColl = figma.variables.createVariableCollection("Spacing");
spacingColl.renameMode(spacingColl.modes[0].modeId, "Value");
const valueMode = spacingColl.modes[0].modeId;


return {
  collectionId: spacingColl.id,
  modeId: valueMode
};
```

---

## 3. Creating All Variable Types

### hex → {r, g, b} Conversion Helper

Colors in the Figma Plugin API are 0–1 range, not 0–255. Embed this helper in any script that creates color variables:

```javascript
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16) / 255,
    g: parseInt(clean.substring(2, 4), 16) / 255,
    b: parseInt(clean.substring(4, 6), 16) / 255
  };
}

// With alpha channel (for semi-transparent primitives like Black/200 at 10%):
function hexToRgba(hex) {
  const clean = hex.replace('#', '');
  const hasAlpha = clean.length === 8;
  return {
    r: parseInt(clean.substring(0, 2), 16) / 255,
    g: parseInt(clean.substring(2, 4), 16) / 255,
    b: parseInt(clean.substring(4, 6), 16) / 255,
    a: hasAlpha ? parseInt(clean.substring(6, 8), 16) / 255 : 1
  };
}

// Usage:
// hexToRgb('#3B82F6')        → {r: 0.231, g: 0.510, b: 0.965}
// hexToRgb('#14AE5C')        → {r: 0.078, g: 0.682, b: 0.361}
// hexToRgba('#0c0c0d1a')     → {r: 0.047, g: 0.047, b: 0.051, a: 0.102}
```

### Creating Primitive Color Variables (Real SDS Data)

This creates a subset of the Simple Design System's `Color Primitives` collection (Blue family, from the Standard pattern used by real design systems):

```javascript
function hexToRgb(hex) {
  const c = hex.replace('#', '');
  return { r: parseInt(c.slice(0,2),16)/255, g: parseInt(c.slice(2,4),16)/255, b: parseInt(c.slice(4,6),16)/255 };
}

// Get the Primitives collection created in the previous step
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const primColl = collections.find(c => c.name === 'Primitives');
if (!primColl) throw new Error("Primitives collection not found — run collection creation first");
const valueMode = primColl.modes[0].modeId;

    // Define primitives — use real values from your codebase
    const primitiveColors = [
      // Blue scale
      { name: 'blue/100', hex: '#EFF6FF' },
      { name: 'blue/200', hex: '#DBEAFE' },
      { name: 'blue/300', hex: '#93C5FD' },
      { name: 'blue/400', hex: '#60A5FA' },
      { name: 'blue/500', hex: '#3B82F6' },
      { name: 'blue/600', hex: '#2563EB' },
      { name: 'blue/700', hex: '#1D4ED8' },
      { name: 'blue/800', hex: '#1E40AF' },
      { name: 'blue/900', hex: '#1E3A8A' },
      // Gray scale
      { name: 'gray/100', hex: '#F9FAFB' },
      { name: 'gray/200', hex: '#F3F4F6' },
      { name: 'gray/300', hex: '#D1D5DB' },
      { name: 'gray/400', hex: '#9CA3AF' },
      { name: 'gray/500', hex: '#6B7280' },
      { name: 'gray/600', hex: '#4B5563' },
      { name: 'gray/700', hex: '#374151' },
      { name: 'gray/800', hex: '#1F2937' },
      { name: 'gray/900', hex: '#111827' },
      // White / Black
      { name: 'white/1000', hex: '#FFFFFF' },
      { name: 'black/1000', hex: '#000000' },
    ];

    const created = [];
    for (const { name, hex } of primitiveColors) {
      const v = figma.variables.createVariable(name, primColl, 'COLOR');
      v.setValueForMode(valueMode, hexToRgb(hex));
      // Primitives: EMPTY scopes (hidden from all pickers — designers use semantics)
      v.scopes = [];
      // Code syntax from the actual CSS variable name
      v.setVariableCodeSyntax('WEB', `var(--color-${name.replace('/', '-')})`);
      created.push({ name, id: v.id });
    }

return { created, count: created.length };
```

**Critical scope rule for primitives:** Set `v.scopes = []`. This hides primitives from every picker. Designers should only see semantic tokens. The exception is semi-transparent overlay primitives (Black/White with alpha) — those get `["EFFECT_COLOR"]` so they appear in shadow pickers.

### Creating FLOAT Variables (Spacing, Radius, Font Size)

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const spacingColl = collections.find(c => c.name === 'Spacing');
if (!spacingColl) throw new Error("Spacing collection not found");
const valueMode = spacingColl.modes[0].modeId;

const spacingTokens = [
  { name: 'spacing/xs',  value: 4,  scope: 'GAP', cssVar: '--spacing-xs' },
  { name: 'spacing/sm',  value: 8,  scope: 'GAP', cssVar: '--spacing-sm' },
  { name: 'spacing/md',  value: 16, scope: 'GAP', cssVar: '--spacing-md' },
  { name: 'spacing/lg',  value: 24, scope: 'GAP', cssVar: '--spacing-lg' },
  { name: 'spacing/xl',  value: 32, scope: 'GAP', cssVar: '--spacing-xl' },
  { name: 'spacing/2xl', value: 48, scope: 'GAP', cssVar: '--spacing-2xl' },
];

const radiusTokens = [
  { name: 'radius/none', value: 0,    scope: 'CORNER_RADIUS', cssVar: '--radius-none' },
  { name: 'radius/sm',   value: 4,    scope: 'CORNER_RADIUS', cssVar: '--radius-sm' },
  { name: 'radius/md',   value: 8,    scope: 'CORNER_RADIUS', cssVar: '--radius-md' },
  { name: 'radius/lg',   value: 16,   scope: 'CORNER_RADIUS', cssVar: '--radius-lg' },
  { name: 'radius/full', value: 9999, scope: 'CORNER_RADIUS', cssVar: '--radius-full' },
];

const created = [];
for (const { name, value, scope, cssVar } of [...spacingTokens, ...radiusTokens]) {
  const v = figma.variables.createVariable(name, spacingColl, 'FLOAT');
  v.setValueForMode(valueMode, value);
  v.scopes = [scope];
  v.setVariableCodeSyntax('WEB', `var(${cssVar})`);
  created.push({ name, value, id: v.id });
}

return { created, count: created.length };
```

### Creating STRING Variables (Font Family, Font Style)

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const typoPrimColl = collections.find(c => c.name === 'Typography Primitives');
if (!typoPrimColl) throw new Error("Typography Primitives collection not found");
const valueMode = typoPrimColl.modes[0].modeId;

const fontTokens = [
  { name: 'family/sans',  value: 'Inter',       scope: 'FONT_FAMILY', cssVar: '--font-family-sans' },
  { name: 'family/mono',  value: 'Roboto Mono',  scope: 'FONT_FAMILY', cssVar: '--font-family-mono' },
  // Font style strings — these are the Figma fontName.style values:
  { name: 'weight/regular',  value: 'Regular',   scope: 'FONT_STYLE',  cssVar: '--font-weight-regular' },
  { name: 'weight/medium',   value: 'Medium',    scope: 'FONT_STYLE',  cssVar: '--font-weight-medium' },
  { name: 'weight/semibold', value: 'Semi Bold', scope: 'FONT_STYLE',  cssVar: '--font-weight-semibold' },
  { name: 'weight/bold',     value: 'Bold',      scope: 'FONT_STYLE',  cssVar: '--font-weight-bold' },
];

const created = [];
for (const { name, value, scope, cssVar } of fontTokens) {
  const v = figma.variables.createVariable(name, typoPrimColl, 'STRING');
  v.setValueForMode(valueMode, value);
  v.scopes = [scope];
  v.setVariableCodeSyntax('WEB', `var(${cssVar})`);
  created.push({ name, value, id: v.id });
}

return { created, count: created.length };
```

### Creating BOOLEAN Variables

BOOLEAN variables have no scopes (scopes are not supported for BOOLEAN type).

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const coll = collections.find(c => c.name === 'Tokens');
if (!coll) throw new Error("Collection not found");
const valueMode = coll.modes[0].modeId;

const v = figma.variables.createVariable('feature-flags/show-beta-badge', coll, 'BOOLEAN');
v.setValueForMode(valueMode, false);
// No scopes — BOOLEAN does not support scopes

return { id: v.id, name: v.name };
```

---

## 4. Variable Aliasing (VARIABLE_ALIAS) — Primitive → Semantic Chain

Semantic tokens reference primitives via `VARIABLE_ALIAS`. This is the core pattern that makes light/dark theming work.

**Architecture:**
```
Color Primitives collection (1 mode: Value)
  blue/500 = #3B82F6          ← raw value

Color collection (2 modes: Light, Dark)
  color/bg/accent/default:
    Light → VARIABLE_ALIAS → Primitives/blue/500
    Dark  → VARIABLE_ALIAS → Primitives/blue/300
```

### Complete Semantic Alias Creation Script (SDS-style)

```javascript
function hexToRgb(hex) {
  const c = hex.replace('#', '');
  return { r: parseInt(c.slice(0,2),16)/255, g: parseInt(c.slice(2,4),16)/255, b: parseInt(c.slice(4,6),16)/255 };
}

const collections = await figma.variables.getLocalVariableCollectionsAsync();

const primColl = collections.find(c => c.name === 'Primitives');
const colorColl = collections.find(c => c.name === 'Color');
if (!primColl || !colorColl) throw new Error("Collections not found — run primitive/color collection creation first");

const primValueMode = primColl.modes[0].modeId;
const lightModeId = colorColl.modes.find(m => m.name === 'Light').modeId;
const darkModeId = colorColl.modes.find(m => m.name === 'Dark').modeId;

// Load all primitive variables for lookup
const allVars = await figma.variables.getLocalVariablesAsync();
const primsByName = {};
for (const v of allVars) {
  if (v.variableCollectionId === primColl.id) {
    primsByName[v.name] = v;
  }
}

function getPrim(name) {
  const v = primsByName[name];
  if (!v) throw new Error(`Primitive not found: ${name}`);
  return v;
}

// Define semantic → [lightPrimitiveName, darkPrimitiveName]
// Following the SDS pattern: Background/{Intent}/{Emphasis}
const semanticColors = [
  // Background
  { name: 'color/bg/default/default',   lightPrim: 'white/1000', darkPrim: 'gray/900',
    cssVar: '--color-bg-default-default', scopes: ['FRAME_FILL', 'SHAPE_FILL'] },
  { name: 'color/bg/default/secondary', lightPrim: 'gray/100', darkPrim: 'gray/800',
    cssVar: '--color-bg-default-secondary', scopes: ['FRAME_FILL', 'SHAPE_FILL'] },
  { name: 'color/bg/brand/default',     lightPrim: 'blue/600', darkPrim: 'blue/300',
    cssVar: '--color-bg-brand-default', scopes: ['FRAME_FILL', 'SHAPE_FILL'] },
  // Text
  { name: 'color/text/default/default', lightPrim: 'gray/900', darkPrim: 'white/1000',
    cssVar: '--color-text-default-default', scopes: ['TEXT_FILL'] },
  { name: 'color/text/default/secondary', lightPrim: 'gray/500', darkPrim: 'gray/400',
    cssVar: '--color-text-default-secondary', scopes: ['TEXT_FILL'] },
  { name: 'color/text/brand/default',   lightPrim: 'blue/700', darkPrim: 'blue/200',
    cssVar: '--color-text-brand-default', scopes: ['TEXT_FILL'] },
  // Border
  { name: 'color/border/default/default', lightPrim: 'gray/300', darkPrim: 'gray/600',
    cssVar: '--color-border-default-default', scopes: ['STROKE_COLOR'] },
  { name: 'color/border/brand/default',   lightPrim: 'blue/500', darkPrim: 'blue/400',
    cssVar: '--color-border-brand-default', scopes: ['STROKE_COLOR'] },
];

const created = [];
for (const { name, lightPrim, darkPrim, cssVar, scopes } of semanticColors) {
  const v = figma.variables.createVariable(name, colorColl, 'COLOR');
  // Alias to primitive in Light mode
  v.setValueForMode(lightModeId, figma.variables.createVariableAlias(getPrim(lightPrim)));
  // Alias to primitive in Dark mode
  v.setValueForMode(darkModeId, figma.variables.createVariableAlias(getPrim(darkPrim)));
  // Set scopes (semantic layer — these ARE shown in pickers)
  v.scopes = scopes;
  // Code syntax
  v.setVariableCodeSyntax('WEB', `var(${cssVar})`);
  created.push({ name, id: v.id });
}

return { created, count: created.length };
```

**Key API points:**
- `figma.variables.createVariableAlias(variable)` — takes a Variable object, returns `{type:'VARIABLE_ALIAS', id: variable.id}`
- The aliased variable MUST have the same `resolvedType` as the semantic variable
- Never duplicate raw values in the semantic layer — always alias

---

## 5. Variable Scopes — Complete Reference Table

| Semantic Role | Recommended Scopes | Variable Type |
|---|---|---|
| Primitive colors (raw) | `[]` — empty, hidden from all pickers | COLOR |
| Semi-transparent overlay primitives | `["EFFECT_COLOR"]` | COLOR |
| Background fills (frame, shape) | `["FRAME_FILL", "SHAPE_FILL"]` | COLOR |
| Text color | `["TEXT_FILL"]` | COLOR |
| Icon / shape fill | `["SHAPE_FILL", "STROKE_COLOR"]` | COLOR |
| Border / stroke color | `["STROKE_COLOR"]` | COLOR |
| Background + border combined | `["FRAME_FILL", "SHAPE_FILL", "STROKE_COLOR"]` | COLOR |
| Shadow color | `["EFFECT_COLOR"]` | COLOR |
| Spacing / gap between items | `["GAP"]` | FLOAT |
| Padding (if separate from gap) | `["GAP"]` | FLOAT |
| Corner radius | `["CORNER_RADIUS"]` | FLOAT |
| Width / height dimensions | `["WIDTH_HEIGHT"]` | FLOAT |
| Font size | `["FONT_SIZE"]` | FLOAT |
| Line height | `["LINE_HEIGHT"]` | FLOAT |
| Letter spacing | `["LETTER_SPACING"]` | FLOAT |
| Font weight (numeric) | `["FONT_WEIGHT"]` | FLOAT |
| Stroke width | `["STROKE_FLOAT"]` | FLOAT |
| Effect blur radius | `["EFFECT_FLOAT"]` | FLOAT |
| Opacity | `["OPACITY"]` | FLOAT |
| Font family | `["FONT_FAMILY"]` | STRING |
| Font style (font-specific name, e.g. `"Regular"` — varies per font) | `["FONT_STYLE"]` | STRING |
| Boolean flags | *(scopes not supported)* | BOOLEAN |

**Never use `ALL_SCOPES`** on any variable. It pollutes every picker with irrelevant tokens. The Simple Design System (SDS), the gold standard, uses targeted scopes on every variable.

**`ALL_FILLS` note:** `ALL_FILLS` is exclusive among fill scopes — it covers `FRAME_FILL`, `SHAPE_FILL`, and `TEXT_FILL` together. If set, you cannot also add individual fill scopes. Prefer specifying individual scopes for precision.

### Batch Scope-Setting (After Variables are Created)

If you created variables without scopes and need to set them in batch:

```javascript
const allVars = await figma.variables.getLocalVariablesAsync();

// Scope mapping: partial name match → scopes
const scopeRules = [
  { match: 'color/bg/',     scopes: ['FRAME_FILL', 'SHAPE_FILL'] },
  { match: 'color/text/',   scopes: ['TEXT_FILL'] },
  { match: 'color/icon/',   scopes: ['SHAPE_FILL', 'STROKE_COLOR'] },
  { match: 'color/border/', scopes: ['STROKE_COLOR'] },
  { match: 'spacing/',      scopes: ['GAP'] },
  { match: 'radius/',       scopes: ['CORNER_RADIUS'] },
  { match: 'blue/',         scopes: [] },   // primitives — hide
  { match: 'gray/',         scopes: [] },
  { match: 'white/',        scopes: [] },
  { match: 'black/',        scopes: [] },
];

const updated = [];
for (const v of allVars) {
  if (v.remote) continue; // skip library variables
  for (const rule of scopeRules) {
    if (v.name.startsWith(rule.match)) {
      v.scopes = rule.scopes;
      updated.push({ name: v.name, scopes: rule.scopes });
      break;
    }
  }
}

return { updated, count: updated.length };
```

---

## 6. Code Syntax — WEB/ANDROID/iOS

Every variable must have code syntax set. This is what powers the developer handoff experience:

**What code syntax does:** When a developer inspects any element in Figma Dev Mode that has a variable-bound property (fill, padding, radius, etc.), the code snippet shown uses the variable's code syntax name — not the Figma variable name. For example, a button's background fill bound to `color/bg/primary` will show `background: var(--color-bg-primary)` in the CSS snippet, not `color/bg/primary`. Without code syntax set, Dev Mode shows raw hex values or nothing useful.

You can set up to **3 syntaxes per variable** — one per platform (Web, iOS, Android). Set all three if the codebase targets multiple platforms; set only WEB if it's a web-only project.

```javascript
// WEB: MUST include the var() wrapper — this is the full CSS function syntax
variable.setVariableCodeSyntax('WEB', 'var(--color-bg-primary)');
//                                     ^^^^                   ^
//                              var() wrapper is REQUIRED

// ANDROID: Kotlin property name — camelCase, no wrapper
variable.setVariableCodeSyntax('ANDROID', 'colorBgPrimary');

// iOS: Swift property — dot-notation, no wrapper
variable.setVariableCodeSyntax('iOS', 'Color.bgPrimary');
```

> **CRITICAL — WEB code syntax MUST use the `var()` wrapper.** Setting just `--color-bg-primary` (without `var()`) will cause Dev Mode to show raw hex values instead of the CSS variable reference. Always use the full `var(--name)` form. ANDROID and iOS do NOT use a wrapper.

**Platform derivation rules from the CSS variable name:**

| Platform | Pattern | Example |
|---|---|---|
| WEB | **`var(--{css-var-name})`** — `var()` wrapper required | `var(--sds-color-bg-primary)` |
| ANDROID | camelCase, no wrapper, strip `--` prefix | `sdsColorBgPrimary` |
| iOS | PascalCase after `.`, no wrapper, strip `--` prefix | `Color.SdsColorBgPrimary` or `Color.bgPrimary` |

**Always use the actual CSS variable name from the codebase** — do not derive it from the Figma variable name. If the code uses `--sds-color-background-brand-default`, that exact string is the WEB code syntax (minus the `var()` wrapper that you add).

### Batch Code Syntax Setting

```javascript
const allVars = await figma.variables.getLocalVariablesAsync();
const updated = [];

for (const v of allVars) {
  if (v.remote) continue;
  // If code syntax already set, skip
  if (v.codeSyntax['WEB']) continue;

  // FALLBACK: derive from Figma name: color/bg/primary → var(--color-bg-primary)
  // PREFERRED: pass in a cssVarMap built from actual codebase CSS variable names
  // e.g. cssVarMap = { 'color/bg/primary': '--color-bg-primary', ... }
  const cssName = cssVarMap?.[v.name]
    ?? v.name.replace(/\//g, '-').replace(/\s/g, '-').toLowerCase();
  v.setVariableCodeSyntax('WEB', `var(--${cssName})`);
  updated.push({ name: v.name, web: `var(--${cssName})` });
}

return { updated, count: updated.length };
```

Note: derived names are a fallback only. Always prefer overriding with actual CSS variable names from the codebase when they are known.

---

## 7. Effect Styles (Shadows) and Text Styles

Shadows and composite typography cannot be variables — they are Styles.

### Creating Effect Styles (Shadows)

Reference from SDS (15 effect styles) and the SDS shadow pattern `Shadow/{Level}`:

```javascript
// Shadow definitions — CSS equivalent in comments
// CSS: 0 1px 2px rgba(0,0,0,0.05)
const shadows = [
  {
    name: 'Shadow/Subtle',
    effects: [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.05 },
      offset: { x: 0, y: 1 },
      radius: 2,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL'
    }]
  },
  {
    // CSS: 0 4px 6px -1px rgba(0,0,0,0.10), 0 2px 4px -1px rgba(0,0,0,0.06)
    name: 'Shadow/Medium',
    effects: [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.10 },
        offset: { x: 0, y: 4 },
        radius: 6,
        spread: -1,
        visible: true,
        blendMode: 'NORMAL'
      },
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.06 },
        offset: { x: 0, y: 2 },
        radius: 4,
        spread: -1,
        visible: true,
        blendMode: 'NORMAL'
      }
    ]
  },
  {
    // CSS: 0 10px 15px -3px rgba(0,0,0,0.10), 0 4px 6px -2px rgba(0,0,0,0.05)
    name: 'Shadow/Strong',
    effects: [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.10 },
        offset: { x: 0, y: 10 },
        radius: 15,
        spread: -3,
        visible: true,
        blendMode: 'NORMAL'
      },
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.05 },
        offset: { x: 0, y: 4 },
        radius: 6,
        spread: -2,
        visible: true,
        blendMode: 'NORMAL'
      }
    ]
  }
];

// M3-style dual shadow (umbra + penumbra pattern):
const m3Shadows = [
  {
    name: 'Elevation/1',
    effects: [
      { type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.30}, offset:{x:0,y:1}, radius:2, spread:0, visible:true, blendMode:'NORMAL' },
      { type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.15}, offset:{x:0,y:1}, radius:3, spread:1, visible:true, blendMode:'NORMAL' }
    ]
  },
  {
    name: 'Elevation/2',
    effects: [
      { type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.30}, offset:{x:0,y:1}, radius:2, spread:0, visible:true, blendMode:'NORMAL' },
      { type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.15}, offset:{x:0,y:2}, radius:6, spread:2, visible:true, blendMode:'NORMAL' }
    ]
  },
  {
    name: 'Elevation/3',
    effects: [
      { type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.30}, offset:{x:0,y:1}, radius:3, spread:0, visible:true, blendMode:'NORMAL' },
      { type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.15}, offset:{x:0,y:4}, radius:8, spread:3, visible:true, blendMode:'NORMAL' }
    ]
  }
];

const created = [];
for (const { name, effects } of shadows) {
  const style = figma.createEffectStyle();
  style.name = name;
  style.effects = effects;
  created.push({ name, id: style.id });
}

return { created, count: created.length };
```

### Creating Text Styles

Fonts must be loaded before creating text styles.

```javascript
// Define text styles — based on SDS typography hierarchy
const textStyles = [
  // Display / Hero
  { name: 'Display/Hero',    family: 'Inter', style: 'Bold',      size: 72, lineHeight: 80, letterSpacing: -1.5 },
  // Headings
  { name: 'Heading/H1',      family: 'Inter', style: 'Bold',      size: 48, lineHeight: 56, letterSpacing: -1.0 },
  { name: 'Heading/H2',      family: 'Inter', style: 'Bold',      size: 40, lineHeight: 48, letterSpacing: -0.5 },
  { name: 'Heading/H3',      family: 'Inter', style: 'Semi Bold', size: 32, lineHeight: 40, letterSpacing: 0 },
  { name: 'Heading/H4',      family: 'Inter', style: 'Semi Bold', size: 24, lineHeight: 32, letterSpacing: 0 },
  // Body
  { name: 'Body/Large',      family: 'Inter', style: 'Regular',   size: 18, lineHeight: 28, letterSpacing: 0 },
  { name: 'Body/Medium',     family: 'Inter', style: 'Regular',   size: 16, lineHeight: 24, letterSpacing: 0 },
  { name: 'Body/Small',      family: 'Inter', style: 'Regular',   size: 14, lineHeight: 20, letterSpacing: 0 },
  // Label
  { name: 'Label/Large',     family: 'Inter', style: 'Medium',    size: 14, lineHeight: 20, letterSpacing: 0.1 },
  { name: 'Label/Medium',    family: 'Inter', style: 'Medium',    size: 12, lineHeight: 16, letterSpacing: 0.5 },
  { name: 'Label/Small',     family: 'Inter', style: 'Medium',    size: 11, lineHeight: 16, letterSpacing: 0.5 },
  // Code
  { name: 'Code/Base',       family: 'Roboto Mono', style: 'Regular', size: 14, lineHeight: 20, letterSpacing: 0 },
];

// Verify fonts are available, then load them
const allFonts = await figma.listAvailableFontsAsync();
const availableFontNames = new Set(allFonts.map(f => JSON.stringify(f.fontName)));
const fontSet = new Set(textStyles.map(s => JSON.stringify({ family: s.family, style: s.style })));
for (const f of fontSet) {
  if (!availableFontNames.has(f)) {
    const parsed = JSON.parse(f);
    const familyFonts = allFonts.filter(af => af.fontName.family === parsed.family);
    throw new Error(`Font "${parsed.family} ${parsed.style}" not available. Available styles: ${familyFonts.map(af => af.fontName.style).join(', ') || 'none'}`);
  }
}
await Promise.all([...fontSet].map(f => figma.loadFontAsync(JSON.parse(f))));

const created = [];
for (const { name, family, style, size, lineHeight, letterSpacing } of textStyles) {
  const ts = figma.createTextStyle();
  ts.name = name;
  ts.fontName = { family, style };
  ts.fontSize = size;
  ts.lineHeight = { value: lineHeight, unit: 'PIXELS' };
  ts.letterSpacing = { value: letterSpacing, unit: 'PIXELS' };
  created.push({ name, id: ts.id });
}

return { created, count: created.length };
```

---

## 8. Idempotency — Check-Before-Create Pattern

Every creation script should check whether the entity already exists before creating it. This prevents duplicates when a script is re-run after partial failure.

### Check-Before-Create for Collections

```javascript
// Check if already exists
const existing = await figma.variables.getLocalVariableCollectionsAsync();
let primColl = existing.find(c => c.name === 'Primitives');

if (primColl) {
  return { status: 'already_exists', collectionId: primColl.id, name: primColl.name };
}

// Create only if not found
primColl = figma.variables.createVariableCollection("Primitives");
primColl.renameMode(primColl.modes[0].modeId, "Value");

return { status: 'created', collectionId: primColl.id };
```

### Check-Before-Create for Variables

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const primColl = collections.find(c => c.name === 'Primitives');
if (!primColl) throw new Error('Primitives collection not found');

// Variable names are unique within this deterministic collection.
const allVars = await figma.variables.getLocalVariablesAsync();
const existing = allVars.find(v =>
  v.variableCollectionId === primColl.id && v.name === 'blue/500'
);

if (existing) {
  return { status: 'already_exists', id: existing.id, name: existing.name };
}

// ... create the variable ...
return { status: 'created' };
```

**Cleanup by exact state-ledger ID:**

```javascript
const VARIABLE_IDS = ['VariableID:1:8', 'VariableID:1:9'];
const removed = [];
for (const id of VARIABLE_IDS) {
  const variable = await figma.variables.getVariableByIdAsync(id);
  if (!variable) continue;
  removed.push(variable.id);
  variable.remove();
}
return { removed, count: removed.length };
```

**Never clean up by a name or prefix.** It can match data not created by the current workflow.

---

## 9. Validation — Verify Counts, Aliases, and Scopes

Run the applicable scripts after creating or updating the selected tokens. Use the results to stop a token-only workflow or to continue to an in-scope dependent asset.

### Verify Collection and Variable Counts

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const allVars = await figma.variables.getLocalVariablesAsync();

const summary = collections.map(c => {
  const vars = allVars.filter(v => v.variableCollectionId === c.id);
  return {
    name: c.name,
    id: c.id,
    modes: c.modes.map(m => m.name),
    variableCount: vars.length,
    missingScopes: vars.filter(v => v.scopes.length === 0 && v.resolvedType !== 'BOOLEAN').length,
    missingCodeSyntax: vars.filter(v => !v.codeSyntax['WEB'] && !v.remote).length,
    sampleVariables: vars.slice(0, 3).map(v => v.name)
  };
});

return {
  collectionCount: collections.length,
  totalVariables: allVars.length,
  collections: summary
};
```

Interpret: `missingScopes > 0` (for non-primitives and non-BOOLEANs) → scope-setting failed, re-run scope script. `missingCodeSyntax > 0` → code syntax not set, run batch code syntax script.

Note: primitives correctly have `scopes = []` (empty, hidden). `missingScopes` above counts non-BOOLEAN variables with empty scopes — review the list to confirm they are all primitives.

### Verify Aliases Resolve

```javascript
const allVars = await figma.variables.getLocalVariablesAsync();
const collections = await figma.variables.getLocalVariableCollectionsAsync();

const brokenAliases = [];
const aliasedVars = [];

for (const v of allVars) {
  if (v.remote) continue;
  const coll = collections.find(c => c.id === v.variableCollectionId);
  if (!coll) continue;

  for (const [modeId, val] of Object.entries(v.valuesByMode)) {
    if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
      aliasedVars.push({ name: v.name, aliasTargetId: val.id });
      // Verify the target exists
      const target = allVars.find(t => t.id === val.id);
      if (!target) {
        brokenAliases.push({ variable: v.name, modeId, missingTargetId: val.id });
      }
    }
  }
}

return {
  totalAliased: aliasedVars.length,
  brokenAliases,
  brokenCount: brokenAliases.length,
  status: brokenAliases.length === 0 ? 'all_aliases_resolve' : 'BROKEN_ALIASES_FOUND'
};
```

Interpret: `brokenCount > 0` means a semantic variable references a primitive that was deleted or not yet created. Create the missing primitives, then re-run alias creation for the affected semantic variables.

### Verify Style Counts

```javascript
const [textStyles, effectStyles] = await Promise.all([
  figma.getLocalTextStylesAsync(),
  figma.getLocalEffectStylesAsync()
]);

return {
  textStyles: textStyles.map(s => ({ name: s.name, fontSize: s.fontSize, fontFamily: s.fontName.family })),
  effectStyles: effectStyles.map(s => ({ name: s.name, effectCount: s.effects.length })),
  counts: { text: textStyles.length, effect: effectStyles.length }
};
```

### Token Exit Criteria Checklist

Before declaring token work complete or proceeding to an in-scope dependent asset, verify all of the following:

- Every planned collection exists with the correct number of modes
- Primitive variables: `scopes = []`, code syntax set
- Semantic variables: targeted scopes set, code syntax set, aliases pointing to primitives (not raw values)
- All broken alias count = 0
- All planned text styles exist with correct font family/size/weight
- All planned effect styles exist with correct shadow values
- No variable has `ALL_SCOPES` unless explicitly approved by the user
