# Working with design systems: Effect Styles

Effect styles in Figma are named, reusable definitions of one or more visual effects — drop shadows, inner shadows, and blurs. They are the closest equivalent to a shadow or elevation token in a design system.

Effect styles are distinct from variables. There is no single variable type that represents a shadow. However, individual numeric and color properties within an effect _can_ be bound to variables, allowing shadow values to participate in a token system.

## Model

An `EffectStyle` has one core writable property beyond the base style fields:

| Property      | Type                    | Notes                                                 |
| ------------- | ----------------------- | ----------------------------------------------------- |
| `name`        | `string`                | Slash-delimited for grouping (e.g. `"Elevation/200"`) |
| `effects`     | `ReadonlyArray<Effect>` | **Read-only array** — clone, modify, reassign         |
| `description` | `string`                | Inherited from `BaseStyleMixin`                       |

### Effect types

An `Effect` is a discriminated union. The most common types:

| `type`            | Key properties                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `DROP_SHADOW`     | `color: RGBA`, `offset: Vector`, `radius: number`, `spread: number`, `visible: boolean`, `blendMode` |
| `INNER_SHADOW`    | Same as `DROP_SHADOW`                                                                                |
| `LAYER_BLUR`      | `radius: number`, `visible: boolean`                                                                 |
| `BACKGROUND_BLUR` | `radius: number`, `visible: boolean`                                                                 |

All colors are in 0–1 range (`RGBA`), not 0–255.

### Variable bindings on effects

Effect properties that can be bound to variables (via `setBoundVariableForEffect(effect, field, variable)` on a node, or inline when constructing):

`color`, `radius`, `spread`, `offsetX`, `offsetY`

Note: `setBoundVariableForEffect` returns a **new** effect object — you must capture it and reassign the `effects` array.

### Applying an effect style to a node

Assign the style's `id` to the node's `effectStyleId`. The node's `effects` property will then reflect the style's values.

## Common gotchas

- **`effects` is read-only**: You cannot mutate the array in place. Clone it, modify the clone, then reassign: `style.effects = [...style.effects, newEffect]`.
- **Effects stack in order**: The order of effects in the array matters visually. Drop shadows render bottom-to-top.
- **Colors are RGBA 0–1**: `{ r: 0, g: 0, b: 0, a: 0.15 }` — not hex, not 0–255.
- **`getLocalEffectStyles()` is deprecated**: Always use `getLocalEffectStylesAsync()`.
- **Styles are not automatically applied**: Creating an `EffectStyle` has no effect on any node until you assign its ID to a node.

## Code patterns

For runnable code examples (listing, creating, applying effect styles), see [effect-style-patterns.md](../effect-style-patterns.md).
