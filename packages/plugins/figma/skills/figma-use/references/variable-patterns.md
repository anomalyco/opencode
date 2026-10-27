# Variable & Token API Patterns

> Part of the [use_figma skill](../SKILL.md). How to correctly create, bind, scope, and alias variables using the Plugin API.
>
> For design system context (aliasing strategy, mode decisions, code syntax philosophy, grouping conventions), see [wwds-variables](working-with-design-systems/wwds-variables.md).

## Contents

- Creating Variable Collections and Modes
- Creating Variables (All Types)
- Binding Variables to Node Properties
- Variable Scopes: What They Are and How to Set Them
- Variable Aliasing (VARIABLE_ALIAS)
- Code Syntax (setVariableCodeSyntax)
- Importing Library Variables
- Discovering Existing Variables in the File
- Effect Styles (For Shadows)


## Creating Variable Collections and Modes

```javascript
const collection = figma.variables.createVariableCollection("MyCollection");

// A new collection starts with 1 mode named "Mode 1" — always rename it
collection.renameMode(collection.modes[0].modeId, "Light");

// Add additional modes (returns the new modeId)
const darkModeId = collection.addMode("Dark");
const lightModeId = collection.modes[0].modeId;
```

**Mode limits are plan-dependent:** Free = 1 mode, Professional = up to 4, Organization/Enterprise = 40+. If you need many modes, split across multiple collections.

## Creating Variables (All Types)

`figma.variables.createVariable(name, collection, resolvedType)` — the second argument accepts a collection object or ID string (object preferred).

```javascript
// COLOR — values use {r, g, b, a} (all 0–1 range, includes alpha)
const colorVar = figma.variables.createVariable("my-color", collection, "COLOR");
colorVar.setValueForMode(modeId, { r: 0.2, g: 0.36, b: 0.96, a: 1 });

// FLOAT — for spacing, radii, sizing, numeric values
const floatVar = figma.variables.createVariable("my-spacing", collection, "FLOAT");
floatVar.setValueForMode(modeId, 16);

// STRING — for font families, font style names, any text value
const stringVar = figma.variables.createVariable("my-font", collection, "STRING");
stringVar.setValueForMode(modeId, "Inter");

// BOOLEAN
const boolVar = figma.variables.createVariable("my-flag", collection, "BOOLEAN");
boolVar.setValueForMode(modeId, true);

// TIMING — for motion animation durations (value in seconds)
const timingVar = figma.variables.createVariable("motion/duration-fast", collection, "TIMING");
timingVar.setValueForMode(modeId, 0.2);

// EASING — for motion animation easing curves
const easingVar = figma.variables.createVariable("motion/ease-out", collection, "EASING");
easingVar.setValueForMode(modeId, {
  type: "CUSTOM_CUBIC_BEZIER",
  easingFunctionCubicBezier: { x1: 0, y1: 0, x2: 0.58, y2: 1 }
});
```

**Note:** Paint colors use `{r, g, b}` (no alpha), but COLOR variable values use `{r, g, b, a}` (with alpha). Don't mix them up.

**Note:** TIMING values are durations in seconds (e.g., `0.2` for 200ms). EASING values use the same shape as keyframe easing objects — see [motion-easing.md](../../figma-use-motion/references/motion-easing.md) for the full easing object shape.

## Binding Variables to Node Properties

### Color Bindings (Fills, Strokes)

`setBoundVariableForPaint` returns a **NEW paint** — you must capture the return value:

```javascript
// Create a base paint, bind the variable, assign the result
const basePaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
const boundPaint = figma.variables.setBoundVariableForPaint(basePaint, "color", colorVar);
node.fills = [boundPaint];

// Only SOLID paints support color variable binding — gradients/images will throw
```

### Numeric Bindings (Spacing, Radii, Sizing)

`setBoundVariable` binds FLOAT/STRING/BOOLEAN variables to node properties:

```javascript
// Padding
node.setBoundVariable("paddingTop", spacingVar);
node.setBoundVariable("paddingBottom", spacingVar);
node.setBoundVariable("paddingLeft", spacingVar);
node.setBoundVariable("paddingRight", spacingVar);

// Gap
node.setBoundVariable("itemSpacing", gapVar);
node.setBoundVariable("counterAxisSpacing", gapVar);

// Corner radius — use individual corners, NOT cornerRadius
node.setBoundVariable("topLeftRadius", radiusVar);
node.setBoundVariable("topRightRadius", radiusVar);
node.setBoundVariable("bottomLeftRadius", radiusVar);
node.setBoundVariable("bottomRightRadius", radiusVar);

// Size
node.setBoundVariable("width", sizeVar);
node.setBoundVariable("height", sizeVar);
node.setBoundVariable("minWidth", sizeVar);
node.setBoundVariable("maxWidth", sizeVar);

// Other
node.setBoundVariable("opacity", opacityVar);
node.setBoundVariable("strokeWeight", strokeVar);
```

**Not bindable via setBoundVariable:** `fontSize`, `fontWeight`, `lineHeight` — set these directly on text nodes.

### Effect Bindings

```javascript
const effectCopy = JSON.parse(JSON.stringify(node.effects[0]));
const newEffect = figma.variables.setBoundVariableForEffect(effectCopy, "color", colorVar);
// ⚠️ Returns a NEW effect — must capture return value!
node.effects = [newEffect];
// Valid fields: "color" (COLOR), "radius" | "spread" | "offsetX" | "offsetY" (FLOAT)
```

### Applying a Mode to a Frame

```javascript
// All bound children of this frame will resolve to the specified mode's values
frame.setExplicitVariableModeForCollection(collection, modeId);
```

Without this, all nodes use the collection's default (first) mode.

## Variable Scopes: What They Are and How to Set Them

`variable.scopes` controls which Figma property pickers show the variable. The default is `["ALL_SCOPES"]` which shows it everywhere — this is almost never what you want.

```javascript
variable.scopes = ["FRAME_FILL", "SHAPE_FILL"];  // only fill pickers
variable.scopes = ["TEXT_FILL"];                   // only text color picker
variable.scopes = ["GAP"];                         // only gap/spacing pickers
variable.scopes = ["CORNER_RADIUS"];               // only radius pickers
variable.scopes = [];                              // hidden from all pickers
```

**All valid scope values:**
`ALL_SCOPES`, `TEXT_CONTENT`, `CORNER_RADIUS`, `WIDTH_HEIGHT`, `GAP`, `ALL_FILLS`, `FRAME_FILL`, `SHAPE_FILL`, `TEXT_FILL`, `STROKE_COLOR`, `STROKE_FLOAT`, `EFFECT_FLOAT`, `EFFECT_COLOR`, `OPACITY`, `FONT_FAMILY`, `FONT_STYLE`, `FONT_WEIGHT`, `FONT_SIZE`, `LINE_HEIGHT`, `LETTER_SPACING`, `PARAGRAPH_SPACING`, `PARAGRAPH_INDENT`

**Always set scopes explicitly** — `ALL_SCOPES` is the default but almost never what you want. For a comprehensive scope-to-use-case mapping table, see [token-creation.md § Variable Scopes — Complete Reference Table](../../figma-generate-library/references/token-creation.md).

**Always check the existing file's scope patterns before creating variables** — match whatever convention is already in use. See "Discovering Existing Variables" below.

## Variable Aliasing (VARIABLE_ALIAS)

A variable's value can reference another variable via alias. This is how semantic tokens reference primitive tokens:

```javascript
// Set a variable's value as an alias to another variable
semanticVar.setValueForMode(modeId, {
  type: 'VARIABLE_ALIAS',
  id: primitiveVar.id
});
```

When the primitive changes, the semantic variable updates automatically across all modes.

## Code Syntax (setVariableCodeSyntax)

Links a Figma variable back to its code counterpart. Call once per platform:

```javascript
variable.setVariableCodeSyntax('WEB', 'var(--color-bg-default)');
variable.setVariableCodeSyntax('ANDROID', 'colorBgDefault');
variable.setVariableCodeSyntax('iOS', 'Color.bgDefault');

// Read back: variable.codeSyntax → { WEB: '...', ANDROID: '...', iOS: '...' }
```

**When deriving CSS names from Figma names**, replace both slashes AND spaces with hyphens:

```javascript
// WRONG — leaves spaces in CSS variable name
`var(--${figmaName.replace(/\//g, '-').toLowerCase()})`

// CORRECT — replace all whitespace and slashes
`var(--${figmaName.replace(/[\s\/]+/g, '-').toLowerCase()})`

// BEST — use the original CSS variable name from the source, not a derived one
`var(${token.cssVar})`
```

## Importing Library Variables

For variables from **team libraries** (not the current file), use `importVariableByKeyAsync`:

```javascript
// Import a single variable by its key
const colorVar = await figma.variables.importVariableByKeyAsync("VARIABLE_KEY");
// Now use it like any local variable
const paint = figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', colorVar
);
node.fills = [paint];
```

To discover available library variable collections and their variables:

```javascript
// List all available library variable collections
const libCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
// Each has: name, key, libraryName

// Get variables in a specific library collection
const libVars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libCollections[0].key);
// Each has: name, key, resolvedType
// Import the ones you need:
const imported = await figma.variables.importVariableByKeyAsync(libVars[0].key);
```

**When to import vs. use local:** If `variable.remote === true`, it's from a library — you can reference it directly if already imported, or import by key. If `remote === false`, it's local to the file — use `getVariableByIdAsync` directly.

## Discovering Existing Variables in the File

**Always inspect the file's existing variables before creating new ones.** Different files use different naming conventions, scope patterns, and collection structures. Match what's already there.

### List collections with mode info

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const results = collections.map(c => ({
  name: c.name,
  id: c.id,
  varCount: c.variableIds.length,
  modes: c.modes.map(m => ({ name: m.name, id: m.modeId }))
}));
return results;
```

### Inspect scope patterns used in existing variables

```javascript
const collections = await figma.variables.getLocalVariableCollectionsAsync();
// Batch every getVariableByIdAsync into a single Promise.all — sequential
// awaits inside the loop would serialize one IPC round-trip per variable.
const allIds = collections.flatMap(c => c.variableIds);
const allVars = await Promise.all(
  allIds.map(id => figma.variables.getVariableByIdAsync(id))
);
const scopeGroups = {};
for (const v of allVars) {
  if (!v) continue;
  const key = JSON.stringify(v.scopes);
  if (!scopeGroups[key]) scopeGroups[key] = [];
  scopeGroups[key].push(v.name);
}
return scopeGroups;
```

### Build a name→variable lookup for reuse

```javascript
const varByName = {};
for (const v of await figma.variables.getLocalVariablesAsync()) {
  varByName[v.name] = v;
}

// Bind to existing variable by name — no hex values needed
function bindFill(node, varName) {
  const v = varByName[varName];
  if (!v) throw new Error(`Variable not found: ${varName}`);
  const paint = figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', v
  );
  node.fills = [paint];
}
```

**Only create new variables for tokens that have no match in the file.** After building the lookup, compare against the needed tokens and create variables only for the delta.

## Listing Collections with Full Variable Details

The async API returns richer data including code syntax and scopes per variable:

```javascript
/**
 * Lists all local variable collections defined in the current Figma file,
 * including metadata for their modes and variables.
 *
 * @returns {Promise<Array<{
 *   name: string,
 *   id: string,
 *   modes: Array<[name: string, modeId: string]>,
 *   variables: Array<[name: string, id: string, codeSyntax: object, scopes: string[]]>
 * }>>}
 */
async function listVariableCollectionsAndVariables() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  // flatMap every variable ID across all collections into one Promise.all,
  // then look up per-collection from a Map. Avoids nested Promise.all and
  // still issues every lookup in parallel.
  const allIds = collections.flatMap(c => c.variableIds);
  const fetched = await Promise.all(
    allIds.map(id => figma.variables.getVariableByIdAsync(id))
  );
  const byId = new Map(allIds.map((id, i) => [id, fetched[i]]));
  return collections.map(collection => ({
    name: collection.name,
    id: collection.id,
    modes: collection.modes.map(m => [m.name, m.modeId]),
    variables: collection.variableIds
      .map(id => byId.get(id))
      .filter(v => v)
      .map(v => [v.name, v.id, v.codeSyntax, v.scopes])
  }));
}
```

Full runnable script:

```javascript
const results = await listVariableCollectionsAndVariables();
return results;
```

## Setting and Removing Code Syntax

Must be executed in the file the variable is defined in:

```javascript
/**
 * Set the code syntax for a variable for a specific platform.
 *
 * @param {string} variableId
 * @param {'WEB'|'ANDROID'|'iOS'} platform
 * @param {string} syntax
 */
async function setVariableCodeSyntax(variableId, platform, syntax) {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  variable.setVariableCodeSyntax(platform, syntax);
}

/**
 * Remove code syntax for a variable for one or more platforms.
 *
 * @param {string} variableId
 * @param {Array<'WEB'|'ANDROID'|'iOS'>} platforms — defaults to all three
 */
async function removeVariableCodeSyntax(variableId, platforms = ["WEB", "ANDROID", "iOS"]) {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  for (const platform of platforms) {
    variable.removeVariableCodeSyntax(platform);
  }
}

/**
 * Set a value for a variable in a specific mode.
 * For aliases, value must be: { type: 'VARIABLE_ALIAS', id: '<variableId>' }
 *
 * @param {string} variableId
 * @param {string} modeId
 * @param {string|number|boolean|RGB|RGBA|{type: 'VARIABLE_ALIAS', id: string}} value
 */
async function setVariableValueForMode(variableId, modeId, value) {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  variable.setValueForMode(modeId, value);
}
```

## Effect Styles (For Shadows)

Shadows can't be stored as variables. Use effect styles. For comprehensive patterns, see [effect-style-patterns.md](effect-style-patterns.md).

```javascript
const shadow = figma.createEffectStyle();
shadow.name = "Shadow/Subtle";
shadow.effects = [{
  type: "DROP_SHADOW",
  color: { r: 0, g: 0, b: 0, a: 0.06 },
  offset: { x: 0, y: 2 },
  radius: 8,
  spread: 0,
  visible: true,
  blendMode: "NORMAL"
}];

// Apply to a node
frame.effectStyleId = shadow.id;
```
