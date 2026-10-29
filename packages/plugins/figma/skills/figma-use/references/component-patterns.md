# Component & Variant API Patterns

> Part of the [use_figma skill](../SKILL.md). How to correctly use the Plugin API for components, variants, and component properties.
>
> For design system context (when to use variants vs properties, code-to-Figma translation, property model), see [wwds-components](working-with-design-systems/wwds-components.md).

## Contents

- Creating a Component
- Combining Components into a Component Set (Variants)
- Laying Out Variants After combineAsVariants (Required)
- Component Properties: addComponentProperty API
- Linking Properties to Child Nodes (Required)
- INSTANCE_SWAP: Avoiding Variant Explosion
- Slots: createSlot and SLOT Properties
- Discovering Existing Conventions in the File
- Importing Components by Key
- Working with Instances (finding variants, setProperties, text overrides, detachInstance)


## Creating a Component

`figma.createComponent()` returns a `ComponentNode`, which behaves like a `FrameNode` but can be published, instanced, and combined into variant sets.

```javascript
const comp = figma.createComponent();
comp.name = "MyComponent";
comp.layoutMode = "HORIZONTAL";
comp.primaryAxisAlignItems = "CENTER";
comp.counterAxisAlignItems = "CENTER";
comp.paddingLeft = 12;
comp.paddingRight = 12;
comp.layoutSizingHorizontal = "HUG";
comp.layoutSizingVertical = "HUG";
comp.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.36, b: 0.96 } }];
```

## Combining Components into a Component Set (Variants)

`figma.combineAsVariants(components, parent)` takes an array of `ComponentNode`s (not frames — frames will throw) and groups them into a `ComponentSetNode`.

Variant names use a `Property=Value` format. Every unique combination must exist as a child component — missing ones show as blank gaps in the variant picker.

```javascript
// Each component's name encodes its variant properties
const comp1 = figma.createComponent();
comp1.name = "size=md, style=primary";
const comp2 = figma.createComponent();
comp2.name = "size=md, style=secondary";

const componentSet = figma.combineAsVariants([comp1, comp2], figma.currentPage);
componentSet.name = "Button";
```

**Before creating variants, inspect the file** for existing naming patterns. Different files use different conventions (`State=Default` vs `state=default` vs `State/Default`). Always match what's already there.

## Laying Out Variants After combineAsVariants (Required)

After `combineAsVariants`, all children stack at `(0, 0)`. You **must** position them or the component set will appear as a single collapsed element with all variants overlapping.

```javascript
const cs = figma.combineAsVariants(components, figma.currentPage);

// Simple row layout
cs.children.forEach((child, i) => {
  child.x = i * 150;
  child.y = 0;
});

// CRITICAL: resize the component set from actual child bounds
let maxX = 0, maxY = 0;
for (const child of cs.children) {
  maxX = Math.max(maxX, child.x + child.width);
  maxY = Math.max(maxY, child.y + child.height);
}
cs.resizeWithoutConstraints(maxX + 40, maxY + 40);
```

For multi-axis variants (e.g., size × style × state), parse the child's name to determine grid position:

```javascript
for (const child of cs.children) {
  const props = Object.fromEntries(
    child.name.split(', ').map(p => p.split('='))
  );
  const col = stateValues.indexOf(props.state);
  const row = styleValues.indexOf(props.style);
  child.x = col * colWidth;
  child.y = row * rowHeight;
}
```

## Component Properties: addComponentProperty API

`addComponentProperty` adds a TEXT, BOOLEAN, or INSTANCE_SWAP property to a component. It returns a **string key** (e.g., `"label#4:0"`) — never hardcode or guess this key.

```javascript
// Returns the key as a string — capture it!
const labelKey = comp.addComponentProperty('Label', 'TEXT', 'Default text');
const showIconKey = comp.addComponentProperty('Show Icon', 'BOOLEAN', true);
const iconSlotKey = comp.addComponentProperty('Icon', 'INSTANCE_SWAP', iconComponentId);
```

**Timing**: Add component properties to each variant component **before** calling `combineAsVariants`. After combining, the component set inherits all properties from its children. Do not add properties to the `ComponentSetNode` directly.

## Linking Properties to Child Nodes (Required)

A property that is added but not linked to a child node does **nothing**. You must set `componentPropertyReferences` on the child:

Follows the [canonical text-edit recipe](gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids) — load the font for every (family, style) you'll mutate (here `Inter Regular`; same rule for every other font) before any `characters`/`fontName`/`fontSize` write.

```javascript
// Load required font BEFORE any text mutation
await figma.loadFontAsync({ family: "Inter", style: "Regular" });

// TEXT property → link to a text node's characters
const labelKey = comp.addComponentProperty('Label', 'TEXT', 'Button');
const textNode = figma.createText();
textNode.characters = "Button";
comp.appendChild(textNode);
textNode.componentPropertyReferences = { characters: labelKey };

// BOOLEAN + INSTANCE_SWAP → link to an instance node
const showIconKey = comp.addComponentProperty('Show Icon', 'BOOLEAN', true);
const iconSlotKey = comp.addComponentProperty('Icon', 'INSTANCE_SWAP', iconComp.id);
const iconInstance = iconComp.createInstance();
comp.appendChild(iconInstance);
iconInstance.componentPropertyReferences = {
  visible: showIconKey,        // BOOLEAN controls show/hide
  mainComponent: iconSlotKey   // INSTANCE_SWAP controls which component
};
```

**Valid `componentPropertyReferences` keys:**
- `characters` — TEXT property on a TextNode
- `visible` — BOOLEAN property (any node)
- `mainComponent` — INSTANCE_SWAP property on an InstanceNode

## Slots: createSlot and SLOT Properties

Slots are designated drop zones inside a component where designers can place arbitrary content in instances — more flexible than INSTANCE_SWAP (which only swaps component instances). They appear as `SlotNode` (type `'SLOT'`) in the Plugin API and as a `SLOT`-typed component property.

### Option 1 — `component.createSlot()` (preferred)

Creates a `SlotNode` as a direct child of the component and automatically creates a linked `SLOT` component property. No manual wiring needed.

```javascript
const card = figma.createComponent();
card.name = "Card";
card.layoutMode = "VERTICAL";
card.primaryAxisSizingMode = "AUTO";
card.counterAxisSizingMode = "FIXED";
card.resize(320, 100);

// Creates a SlotNode and auto-wires a SLOT component property
const contentSlot = card.createSlot();
contentSlot.name = "Content";
contentSlot.layoutMode = "VERTICAL"; // GRID is NOT allowed on slots
contentSlot.resize(320, 200);

// The auto-created property key is accessible via componentPropertyReferences
const slotPropKey = contentSlot.componentPropertyReferences["slotContentId"];
// e.g. "Content#7:1"
```

Multiple slots are supported — each call to `createSlot()` produces a separate slot and property:

```javascript
const contentSlot = card.createSlot();
contentSlot.name = "Content";

const footerSlot = card.createSlot();
footerSlot.name = "Footer";

// Component now has two SLOT properties automatically
return Object.keys(card.componentPropertyDefinitions);
// → ["Content#7:1", "Footer#7:2"]
```

### Option 2 — Manual binding via addComponentProperty

Link a regular frame to a `SLOT` property with `componentPropertyReferences`:

```javascript
const slotPropKey = component.addComponentProperty("Content", "SLOT", "");
const slotFrame = figma.createFrame();
component.appendChild(slotFrame);
// slotFrame must not have GRID layoutMode, and must be a direct child (not nested inside another slot)
slotFrame.componentPropertyReferences = { slotContentId: slotPropKey };
```

### Populating slots in instances

In a component instance, slot nodes are accessible by `findOne()`. Build content and append it to the slot like any other node. In narrow cases the original node handle can be invalidated by the append, so if a post-append edit throws `"Internal Figma Error: Parent not found"`, re-find the sublayer through the slot's `children` and edit through the fresh handle.

```javascript
const instance = card.createInstance();
figma.currentPage.appendChild(instance);

const btn = figma.createFrame();
btn.layoutMode = "HORIZONTAL";
btn.cornerRadius = 8;

// Use the type-indexed criteria for the type filter, then narrow by name.
const contentSlot = instance
  .findAllWithCriteria({ types: ["SLOT"] })
  .find(n => n.name === "Content");
contentSlot.appendChild(btn);

// If a post-append edit throws "Parent not found", re-find via the slot:
// const appended = contentSlot.children[contentSlot.children.length - 1];
// appended.someProperty = ...;
```

### Slot restrictions

- `GRID` layoutMode is not allowed on slot nodes
- Widgets, Stickies, and ComponentNodes cannot be appended directly to a slot
- Frames nested inside another slot cannot themselves be bound to a slot property
- `instance.setProperties({ [slotPropKey]: ... })` throws — slot content is set by appending children, not via `setProperties`
- `slotNode.resetSlot()` (in an instance) reverts the slot to its default empty state

## INSTANCE_SWAP: Avoiding Variant Explosion

When a component has many possible sub-elements (e.g., 30 different icons), **never** create a variant per sub-element. Use a single INSTANCE_SWAP property instead — the user picks from any compatible component at design time.

```javascript
// Create icon as its own ComponentNode
const iconComp = figma.createComponent();
iconComp.name = "Icon/Search";
iconComp.resize(24, 24);
const svgNode = figma.createNodeFromSvg('<svg>...</svg>');
iconComp.appendChild(svgNode);

// Use it as the default for INSTANCE_SWAP
const iconSlotKey = comp.addComponentProperty('Icon', 'INSTANCE_SWAP', iconComp.id);
const instance = iconComp.createInstance();
comp.appendChild(instance);
instance.componentPropertyReferences = { mainComponent: iconSlotKey };
```

This works for icons, avatars, badges, or any swappable nested element.

## Discovering Existing Conventions in the File

**Always inspect the file before creating components.** Different files have different naming styles, structures, and conventions. Your code should match what's already there.

### List all existing components across all pages

`search_design_system` (MCP tool) is an option for published components. For on-canvas components, **don't loop pages inside one script** — even for read-only discovery.

**Prefer the two-step fan-out:**

```javascript
// Step 1 — one cheap use_figma call, no page switch. Returns the page IDs to fan out over.
return figma.root.children.map(p => ({ id: p.id, name: p.name }));
```

Then issue one `use_figma` call per page in parallel. Each script runs:

```javascript
// Step 2 — one call per page, currentPage set exactly once.
// Issue these calls in parallel; do not loop pages inside the script.
const page = await figma.getNodeByIdAsync(PAGE_ID); // PAGE_ID supplied by caller
await figma.setCurrentPageAsync(page);
// Indexed type lookup — much faster than findAll with a side-effect predicate.
const matches = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
return matches.map(n => ({ pageName: page.name, name: n.name, type: n.type, id: n.id }));
```

See [gotchas.md → Set current page once per `use_figma` call](gotchas.md#set-current-page-once-per-use_figma-call--split-multi-page-work-into-parallel-calls) for the full rule.

### Inspect an existing component set's variant naming pattern

```javascript
const cs = await figma.getNodeByIdAsync('COMPONENT_SET_ID');
if (!cs || cs.type !== 'COMPONENT_SET') {
  throw new Error('Expected a component set');
}
const variantNames = cs.children.map(c => c.name);
const propDefs = cs.componentPropertyDefinitions;
return { variantNames, propDefs };
```

### Find existing components in the file

`search_design_system` is an option for published components. For on-canvas components, use the two-step fan-out from the section above — **don't loop pages inside one script.**

**Step 1** — one cheap `use_figma` call returns page IDs:

```javascript
return figma.root.children.map(p => ({ id: p.id, name: p.name }));
```

**Step 2** — issue one `use_figma` call per page in parallel. Each script:

```javascript
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
// Indexed type lookup — much faster than findAll with a side-effect predicate.
const components = page.findAllWithCriteria({ types: ['COMPONENT'] });
return components.map(n => ({ name: n.name, id: n.id, page: page.name, w: n.width, h: n.height }));
```

## Importing Components by Key (Team Libraries)

`importComponentByKeyAsync` and `importComponentSetByKeyAsync` import components from **team libraries** (not the same file you're working in). For components in the current file, use `figma.getNodeByIdAsync()` or `findOne()`/`findAll()` to locate them directly.

```javascript
// Batch independent imports with Promise.all — sequential awaits multiply
// IPC latency by the number of imports for no benefit.
const [comp, set] = await Promise.all([
  figma.importComponentByKeyAsync("COMPONENT_KEY"),
  figma.importComponentSetByKeyAsync("COMPONENT_SET_KEY"),
]);

const instance = comp.createInstance();

const variant = set.children.find(c =>
  c.type === "COMPONENT" && c.name.includes("size=md")
) || set.defaultVariant;
const variantInstance = variant.createInstance();
```

## Working with Instances

### Finding the right variant in a component set

Parse variant names to match on multiple properties simultaneously:

```javascript
const compSet = await figma.importComponentSetByKeyAsync("KEY");

const variant = compSet.children.find(c => {
  const props = Object.fromEntries(
    c.name.split(', ').map(p => p.split('='))
  );
  return props.variant === "primary" && props.size === "md";
}) || compSet.defaultVariant;

const instance = variant.createInstance();
```

### Setting variant properties on an instance

After creating an instance from a component set, you can set variant properties via `setProperties`:

```javascript
const instance = defaultVariant.createInstance();
instance.setProperties({
  "variant": "primary",
  "size": "medium"
});
```

### Overriding text in a component instance

**Always discover component properties BEFORE writing text overrides.** Components expose text as `TEXT`-type component properties, and `setProperties()` is the correct way to override them. Direct `node.characters` changes on property-managed text may be overridden by the component property system on render.

**Step 1: Inspect componentProperties on a sample instance:**

```javascript
const instance = comp.createInstance();
const propDefs = instance.componentProperties;
// Returns e.g.: { "Label#2:0": { type: "TEXT", value: "Button" }, "Has Icon#4:64": { type: "BOOLEAN", value: true } }
return propDefs;
```

Also check nested instances — a parent component may not expose text properties directly, but its nested child instances might:

```javascript
const nestedInstances = instance.findAllWithCriteria({ types: ["INSTANCE"] });
const nestedProps = nestedInstances.map(ni => ({
  name: ni.name,
  id: ni.id,
  properties: ni.componentProperties
}));
```

**Step 2: Use setProperties() for TEXT-type properties:**

```javascript
const instance = comp.createInstance();
const propDefs = instance.componentProperties;
for (const [key, def] of Object.entries(propDefs)) {
  if (def.type === "TEXT") {
    instance.setProperties({ [key]: "New text value" });
  }
}
```

For nested instances that expose their own TEXT properties, call `setProperties()` on the nested instance:

```javascript
// Use the type-indexed criteria for the type filter, then narrow by name.
const nestedHeading = instance
  .findAllWithCriteria({ types: ["INSTANCE"] })
  .find(n => n.name === "Text Heading");
if (nestedHeading) {
  nestedHeading.setProperties({ "Text#2104:5": "Actual heading text" });
}
```

**Step 3: Only fall back to direct node.characters for unmanaged text.** If text is NOT controlled by any component property, find text nodes directly. **Always load the node's actual font first** — instance text nodes inherit fonts from the source component, so don't assume Inter Regular:

```javascript
const textNodes = instance.findAllWithCriteria({ types: ["TEXT"] });
// Dedupe fonts and load them in parallel before mutating text. Awaiting
// loadFontAsync per node in the loop serializes one IPC round-trip per
// text node and reloads the same font repeatedly.
const uniqueFonts = [...new Map(
  textNodes.map(t => [JSON.stringify(t.fontName), t.fontName])
).values()];
await Promise.all(uniqueFonts.map(f => figma.loadFontAsync(f)));
for (const t of textNodes) {
  t.characters = "Updated text";
}
```

### detachInstance() invalidates ancestor node IDs

**Warning:** When `detachInstance()` is called on a nested instance inside a library component instance, the parent instance may also get implicitly detached (converted from INSTANCE to FRAME with a **new ID**). Subsequent `getNodeByIdAsync(oldParentId)` returns null.

```javascript
// WRONG — cached parent ID becomes invalid after child detach
const parentId = parentInstance.id;
nestedChild.detachInstance();
const parent = await figma.getNodeByIdAsync(parentId); // null!

// CORRECT — re-discover nodes by traversal from a stable (non-instance) parent
const stableFrame = await figma.getNodeByIdAsync(manualFrameId); // a frame YOU created
nestedChild.detachInstance();
// Re-find the parent by traversing from the stable frame
const parent = stableFrame.findOne(n => n.name === "ParentName");
```

If you must detach multiple nested instances across sibling components, do it in a **single** `use_figma` call — discover all targets by traversal at the start before any detachment mutates the tree.

## Inspecting Component Metadata (Deep Traversal)

These helpers extract the full property schema and descendant structure of a component. Useful for understanding complex components before creating instances or setting properties.
<a id="component-property-owner-narrowing"></a>**Component-property owner narrowing:** `componentPropertyDefinitions` throws when read from a variant `COMPONENT`, including through optional chaining. Always resolve the property-owning node before touching the getter: a `COMPONENT_SET` owns its definitions, a variant component delegates to its parent set, and a non-variant component owns its own definitions.
```javascript
/**
 * Imports a component or component set from a library by its published key.
 * Tries COMPONENT first, then falls back to COMPONENT_SET.
 *
 * @param {string} componentKey - The published key of the component or component set.
 * @returns {Promise<ComponentNode|ComponentSetNode>}
 */
async function importComponentByKey(componentKey) {
  try {
    return await figma.importComponentByKeyAsync(componentKey);
  } catch {
    try {
      return await figma.importComponentSetByKeyAsync(componentKey);
    } catch {
      throw new Error(`No Component or Component Set available with key '${componentKey}'`);
    }
  }
}

/**
 * Given a main component node, returns the component set parent if one exists,
 * otherwise returns the component itself. Used to get the top-level node that
 * holds `componentPropertyDefinitions`.
 *
 * @param {ComponentNode} mainComponent
 * @returns {ComponentNode|ComponentSetNode}
 */
function getRelevantComponentNode(mainComponent) {
  return mainComponent.parent.type === "COMPONENT_SET"
    ? mainComponent.parent
    : mainComponent;
}

/**
 * Extracts `componentPropertyDefinitions` from a component or component set node
 * into a flat map keyed by property key.
 *
 * @param {ComponentNode|ComponentSetNode} node
 * @returns {Record<string, {name: string, type: string, key: string, variantOptions?: string[]}>}
 */
function getComponentProps(node) {
  const owner = node.type === "COMPONENT" && node.parent.type === "COMPONENT_SET"
    ? node.parent
    : node;
  const definitions = owner.componentPropertyDefinitions;
  const result = {};
  for (const key in definitions) {
    const prop = {
      name: key.replace(/#[^#]+$/, ""),
      type: definitions[key].type,
      key: key
    };
    if (prop.type === "VARIANT") {
      prop.variantOptions = definitions[key].variantOptions;
    }
    result[key] = prop;
  }
  return result;
}

/**
 * Recursively walks a component tree and collects all INSTANCE and TEXT nodes
 * into `result`, keyed by `TYPE[name]`. Handles variant namespacing and
 * deduplicates nodes with identical names but differing property references.
 *
 * @param {SceneNode} node - The node to traverse.
 * @param {string[]} namespace - Accumulated variant names for the current path.
 * @param {Record<string, object>} result - Accumulator object populated in place.
 */
function collectDescendants(node, namespace, result) {
  if (node.type === "INSTANCE" || node.type === "TEXT") {
    const references = node.componentPropertyReferences || {};
    if (!node.visible && !references.visible) return;

    const object = { type: node.type, name: node.name, references };
    let key = `${node.type}[${node.name}]`;

    if (result[key] && JSON.stringify(references) !== JSON.stringify(result[key].references)) {
      key += btoa(btoa(unescape(encodeURIComponent(JSON.stringify(references)))));
    }

    if (node.type === "INSTANCE") {
      const mainComponent = getRelevantComponentNode(node.mainComponent);
      object.properties = getComponentProps(mainComponent);
      object.descendants = {};
      object.mainComponentName = mainComponent.name;
      collectDescendants(mainComponent, [], object.descendants);
    }

    const start = namespace.length ? { variants: [] } : {};
    result[key] = Object.assign(object, result[key] || start);
    if (namespace.length) result[key].variants.push(namespace[namespace.length - 1]);
  } else if ("children" in node && node.visible) {
    if (node.type === "COMPONENT" && node.parent.type === "COMPONENT_SET") namespace.push(node.name);
    node.children.forEach(child => collectDescendants(child, namespace, result));
  }
}

/**
 * Returns structured metadata for a component or component set defined in the current file.
 *
 * @param {string} componentId - The node ID of a COMPONENT or COMPONENT_SET node.
 * @returns {Promise<{name: string, nodeId: string, properties: object, descendants: object}|undefined>}
 */
async function getLocalComponentMetadata(componentId) {
  const node = await figma.getNodeByIdAsync(componentId);
  if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") {
    const result = {
      name: node.name,
      nodeId: node.id,
      properties: {},
      descendants: {}
    };
    result.properties = getComponentProps(node);
    collectDescendants(node, [], result.descendants);
    return result;
  } else {
    throw new Error("Node is not a Component or Component Set");
  }
}

/**
 * Returns structured metadata for a published component or component set loaded by its key.
 *
 * @param {string} componentKey - The published key of the component or component set.
 * @returns {Promise<{name: string, nodeId: string, properties: object, descendants: object}>}
 */
async function getPublishedComponentMetadata(componentKey) {
  const node = await importComponentByKey(componentKey);
  const result = {
    name: node.name,
    nodeId: node.id,
    properties: {},
    descendants: {}
  };
  result.properties = getComponentProps(node);
  collectDescendants(node, [], result.descendants);
  return result;
}
```

### Full metadata extraction script

```javascript
// For local components, use getLocalComponentMetadata:
const result = await getLocalComponentMetadata('COMPONENT_OR_SET_ID');
return result;

// For published components, use getPublishedComponentMetadata:
// const result = await getPublishedComponentMetadata('COMPONENT_KEY');
// return result;
```
