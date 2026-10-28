# Components

Components overlap a lot with the idea of components in a codebase, but with some gaps and other Figma-specific use cases. Components in Figma can be reusable entities that do not have a comparable library pattern, or they can be published and distributed in a library that is aligned to a code forms.

Properties can vary from code in different ways, but alignment to code can still happen without a direct relationship. For example, an interactive pattern in code (like a button) can have many states. A lot of these states (active, focused etc) would be expressed in Figma as variants, which is a concept more closely aligned to properties in a code library. In the case of web this is confusing since hover is not a prop, it is a pseudo selector. At the same time, a color variant might be perfectly aligned between design and code (a property in both places). These discrepancies are accounted for in translation with Figma's Code Connect (deterministic context mapping), but in the case of these tools, must be understood to be properly used.

Figma has four property types, which can be inspected through `componentPropertyDefinitions` on a component set or a non-variant component. A variant component does not own this property; inspect its parent component set instead. To fully understand the component, its descendants must be traversed. Property types include:

- Variant
  - This is reflected as permutations of the component in a Component Set on the canvas. Each variant is explicitly visualized, including an redundant permutations ("Small + Primary + Disabled" may look the same as "Small Secondary Sisabled"). These permutations create different variants implicitly in Figma and it is handled through layer naming (`Variant=Primary,Size=Small,State=Disabled`).
- Text/String
  - Text properties are stored on the component parent, but can be mapped to Text node descendants.
  - `node.componentPropertyReferences.characters` on a descendant text node are how you determine where the text property is referenced (can be multiple, though unlikely).
- Boolean
  - Boolean properties are stored on the component parent, but can be mapped to any node descendant that can have its visibility toggled.
  - `node.componentPropertyReferences.visible` on a descendant node are how you determine where the boolean property is referenced.
- Instance Swap
  - Instance swap properties are stored on the component parent, but can be mapped to Instance node descendants.
  - `node.componentPropertyReferences.mainComponent` on a descendant instance node are how you determine where the instance property is referenced. A classic example of this is an icon property.

## Descriptions

Components and component sets inherit `PublishableMixin`, which includes a writable `description` string. Frames, instances, and other scene nodes do not. In `use_figma`, reading `description` on those unsupported types returns `undefined`, while assigning it throws a `no such property` TypeError. Always narrow by `node.type` before reading or writing it. Setting a description is important for any component intended to be used by others — it appears in Figma's dev mode and component panel, and is surfaced when reading component metadata.

Descriptions should explain the component's intent and any non-obvious usage constraints. They are not a substitute for Code Connect annotations, but they are always visible without any tooling setup.

```js
component.description =
  "Primary action button. Use for the single most important action on a page.";
```

Variant components (children of a component set) also have a `description` field, but in practice the component set description is what users see. Set it on the component set, not on individual variant nodes.

To read descriptions when auditing:

```js
// Get all component sets and their descriptions
figma.root
  .findAllWithCriteria({ types: ["COMPONENT_SET"] })
  .map((n) => ({ name: n.name, description: n.description }));
```

## Usage guidelines

- [Creating components](wwds-components--creating.md): What you must consider when creating new components.
- [Using components](wwds-components--using.md): What you must consider when trying to use the right components.

## Code patterns

For runnable code examples (creating, importing, discovering, inspecting components), see [component-patterns.md](../component-patterns.md).
