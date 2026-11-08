# Working with design systems: Variables

Variables overlap a lot with the idea of tokens in a codebase, but with some gaps and other Figma-specific use cases. Variables are single value, number, string, color, boolean.

In Figma you can do conditional logic and use variables to get basic prototyping functionality. String values can also be used as sophisticated placeholder setups that have different modes for different languages. Not everything you use a variable for in Figma would be used exactly the same way in code. However, for design systems, they are often synced to code in some way.

One gap is the lack of composite tokens. You can't put a box shadow behind a single variable. That is an [effect style](wwds-effect-styles.md), but style values can be bound to variables. Similarly for a type ramp, you have to use [Text Styles](wwds-text-styles.md).

## Model

### Collections

Collections can be thought of a groups in Figma. An example Collection would be "Colors" where there might be a light and dark "Mode." Each value would have two definitions.

### Extended Collections

Extended collections allow you to create a colleciton based on another collection and only override _some_ of the values. Just like inheritance and overrides in CSS. This aligns well for scenarios like branded color themes.

### Modes

Modes in Figma can be thought of like light and dark, but users can specify modes for anything, including sizes, languages (string variables exist in Figma too).

### Aliasing

Aliasing in Figma variables is simply when you point a variable to another variable. Common example is pointing a semantic variable to a primitive variable. Some teams also do component level tokens which adds a third component specific layer.

**Decision rule:** If the source data has two tiers (primitives + semantics), create all primitives first, then create semantic variables that alias into them. If the source data is a single flat tier, create flat variables with no aliases. When in doubt, ask.

### Code Syntax

Code syntax is a surface area in Figma for codebase translation context. You can set WEB, iOS, and ANDROID code syntax on any variable, and when that variable is referenced in other places (visually in Figma's dev mode, or as design context when reading component metadata), this codebase form will appear. These are best thought of as "instance" documentation, eg. `var(--the-thing)` instead of `--the-thing` in the case of CSS.

### Scope

`variable.scopes: VariableScope[]` specifies which properties in Figma the variable can be used for. This is important when you create and when you use variables. **Always set specific scopes rather than leaving the default `ALL_SCOPES`** — it pollutes every property picker with irrelevant tokens. The more specific the better. For the canonical scope-to-use-case mapping, see [token-creation.md § Variable Scopes — Complete Reference Table](../../figma-generate-library/references/token-creation.md).

Common scope values:

- `ALL_SCOPES` — unrestricted; **avoid this** — it is the default but almost never the right choice. Only acceptable for very simple files with a handful of variables where the overhead of precise scoping isn't justified
- `FRAME_FILL`, `SHAPE_FILL`, `TEXT_FILL`, `STROKE_COLOR` — color bindings (use specific fill scopes; `ALL_FILLS` covers all three fill scopes together)
- `TEXT_CONTENT` — string variables for text layers
- `FONT_SIZE`, `FONT_WEIGHT`, `LINE_HEIGHT`, `LETTER_SPACING` — typography
- `CORNER_RADIUS`, `WIDTH_HEIGHT`, `GAP` — layout/spacing
- `OPACITY` — layer opacity

### Grouping

Variable names in Figma are slash delimited and each slash represents a group that is visualized in Figma. When you are doing matching, consider a part of a code prefix might be the name of the collection, not a top level group. Sometimes you will have prefixes in code that aren't in Figma, and that can be ok, just be sure to ask if it is unclear. You can always validate existing variables by referencing the code syntax.

## Common gotchas

- **`createVariableCollection` always creates a default mode** — you will need to rename it (or delete it and add your own) rather than creating from scratch.
- **Duplicate variable names throw silently** — Figma does not error; it creates a second variable with the same name. Always check for existence before creating.
- **Variable aliases require the target to be in the same file** — cross-file aliasing is not supported via the plugin API. If you need to alias to a library variable, import it first.
- **`setValueForMode` with an alias requires the exact shape** — `{ type: 'VARIABLE_ALIAS', id: '<variableId>' }`. Any deviation will silently set the wrong value or throw.

## Usage guidelines

- [Creating variables](wwds-variables--creating.md): What you must consider when creating new variables.
- [Using variables](wwds-variables--using.md): What you must consider when trying to use the right variables.

## Code patterns

For runnable code examples (creating collections, binding variables, scopes, aliasing, discovering existing variables), see [variable-patterns.md](../variable-patterns.md).
