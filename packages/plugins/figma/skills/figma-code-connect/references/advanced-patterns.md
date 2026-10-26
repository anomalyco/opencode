# Code Connect Examples

## Contents
- [Basic component property retrieval](#basic-component-property-retrieval)
- [Descendants and recursive templating](#descendants-and-recursive-templating)
  - [instance.metadata](#instancemetadata)
  - [instance.example](#instanceexample)
  - [Descendant methods](#descendant-methods)

## Basic component property retrieval

- `instance.getEnum`: if you want to map a variant value to something specific
- `instance.getString`: if you want a text property value, or a boolean/variant value back as a string.
- `instance.getBoolean`: if you want to map a boolean value to something specific
- `instance.getInstanceSwap`: if you want to access a swappable instance descendant by property name

### Examples

Both of these are valid, but depending on required outcome, one or the other would be preferred.

```js
const variantMapping = instance.getEnum("Variant", {
  Primary: "primary",
  Secondary: "secondary",
});
const variantTransform = instance.getString("Variant").toLowerCase();
```

Booleans can also be handled similarly. These aren't the best example, but either approach may be preferred depending on the logic of the snippet.

```js
const booleanMapping = instance.getBoolean("Is Highlighted", {
  true: "is-highlighted",
  false: undefined,
});
const boolean = instance.getString("Is Highlighted") === "true";
```

Text properties are always getString()

```js
const label = instance.getString("Label");
```

## Descendants and recursive templating

There are many ways to find descendant layers. Deciding which to use depends on what descendant information is relevant in the parent context. Descendant context could be many things: layer properties, layer name, text content, total descendant count, or a full Code Connect snippet example.

Descendant instances that have Code Connect on them can have `example` (the code snippet object), or `metadata` custom information.

If `node.hasCodeConnect()`, these can be accessed with `const { example, metadata } = node.executeTemplate()`.

### `instance.metadata`

**`metadata.props` is how you can surface non-snippet information upwards**

Any string value can be stored in props. This is additional information to the example snippet. Handy for scenarios where you want single values to be referenced in parent contexts instead of an entire snippet.

> **Important:** For a child template to be discoverable by parent templates (via `findConnectedInstance`, `findConnectedInstances`, or `hasCodeConnect()`), `nestable: true` must be set in **both** the template's `metadata` export **and** in `templateDataJson` when registering via `add_code_connect_map` — e.g. `'{"isParserless": true, "nestable": true}'`. If `nestable` is missing from `templateDataJson`, the child template will not be loaded into the parent's evaluation context.

```js
export default {
  example: figma.html`<ds-child>normal stuff</ds-child>`,
  id: "child",
  metadata: { nestable: true, props: { special: "Special Stuff!!! 🤩" } },
};
```

```js
const child = instance.findConnectedInstance("child");

if (child && child.type === 'INSTANCE') {
  export default {
    example: figma.html`<ds-parent>${child.executeTemplate().metadata?.props?.special}</ds-parent>`,
    id: "parent",
  };
}
```

The output of these templates would be:

```html
<!-- Child snippet by itself -->
<ds-child>normal stuff</ds-child>

<!-- Parent snippet bringing in child metadata -->
<ds-parent>Special Stuff!!! 🤩</ds-parent>
```

### `instance.example`

`instance.executeTemplate().example` contains the code snippet (or an error if the snippet is invalid). It is an array, but should always be treated like a single value and can render just fine in figma's tagged template literals.

**`example` is an object, and should be interpolated via tagged template literals**

If the example is being used as is, stringifying it in a tagged template literal is required, otherwise it'll yield `[object Object]`.

```js
const thing = `<span>${node.executeTemplate().example}</span>`; // Will not work downstream
const thing = figma.html`<span>${node.executeTemplate().example}</span>`; // WILL work downstream

return {
  example: figma.html`${thing}`,
};
```

Arrays should be avoided when referring to template examples, joining them will render to `[object Object]`.

```js
const thing = [];
thing.push(figma.html`<span>${node.executeTemplate().example}</span>`);

return {
  example: figma.html`${thing.join("\n")}`, // BAD: Will not work
  example: figma.html`${thing[0]}`, // Will work...but defeats the purpose of an array and we should use a variable instead.
};
```

Therefore, If you have multiple children examples, set each in a variable.

```js
return {
  example: figma.html`${thingStart}${thing}${thingEnd}`,
};
```

**`example[0].code` is a string when the example is valid**

Digging into the example to get to the snippet string can be useful in rare cases, but requires validation first in case the template can't render. This is rarely recommended and only good if the default template is undesired and `metadata.props` is not an appropriate approach.

```js
const example = node.executeTemplate()?.example[0];
if (example?.type === "CODE") {
  // do something with snippet string
  thing = example.code.replace("abc", "123");
} else {
  // handle error
  thing = `ERROR: ${example?.message}`;
}
```

### Descendant methods

**`instance` nodes**

`instance.getInstanceSwap` and `instance.getString` are the preferred ways to access content when component properties are tied to the values you are looking for. However, if you need to access text node content or instances that are not bound to component properties, there are other methods to get you there:

- `instance.hasCodeConnect()`: Whether or not the instance has code connect on it.
- `instance.codeConnectId()`: String to identify the connected component, set in code connect docs, usefule in filtering or finding the component via methods below.
- `instance.findInstance()`: Only returns a single instance, found by layer name.
- `instance.findText()`: Only returns a single text node, found by layer name.
- `instance.findConnectedInstance()`: Can use the `id` of a descendant (defined in the descendant's export) to remove any variability (layer naming, etc) and find a single instance of a specific component. Returns `ErrorHandle` on failure — check `result.type === 'INSTANCE'` before use.
- `instance.findConnectedInstances()`: To filter or find a list of connected instance descendants. `node.type` and `instance.hasCodeConnect()` are already enforced in this. `node.name` and `instance.codeConnectId()` can be used to filter in the handler.
- `instance.findLayers()`: To filter or find a list of any text or instance descendants. Instances do not have to be connected. `instance.hasCodeConnect()`, `node.type`, `node.name`, and `instance.codeConnectId()` can be used to filter in the handler.

**`text` nodes**

Text nodes only have a single value available in the API:

- `text.textContent`: returns the text content for the node.

#### findInstance versus getInstanceSwap

```js
const hasIcon = instance.getBoolean("Has Icon");
let icon = null;
if (hasIcon) {
  const iconInstance = instance.findInstance("Star Icon"); // INCORRECT: Will be null when icons with other names are in this slot.
  const iconInstance = instance.getInstanceSwap("Icon"); // CORRECT: Will refer to any instance in this slot.
  if (iconInstance && iconInstance.type === 'INSTANCE' && iconInstance.hasCodeConnect()) {
    icon = iconInstance.executeTemplate().example;
  }
}
```

#### findLayers to get a list of strings

```js
const items = [];
instance.findLayers((node) => {
  if (node.type === "TEXT") {
    items.push(`<li>${node.textContent}</li>`);
  }
});
```

#### findLayers to iterate with an index

```js
const items = [];
let i = 0;
instance.findConnectedInstances((node) => {
  if (node.codeConnectId() === "button") {
    items.push(
      figma.code`<span slot="child-${i}">${
        node.executeTemplate().metadata.props.label
      }</span>`,
    );
    i++;
  }
});
```

#### Sophisticated inheritance, three generation example

```js
// url=https://www.figma.com/design?node-id=7699-6920
// source=src/components/Grandparent.js
// component=Grandparent

const figma = require("figma");
const instance = figma.selectedInstance;

const parents = instance.findConnectedInstances(
  (node) => node.codeConnectId() === "parent",
);

export default {
  example: figma.html`<ds-grandparent>
${parents
  .map(
    (node, i) => node.executeTemplate().metadata.props.special + " index: " + i,
  )
  .join("\n")}
</ds-grandparent>`,
  id: "grandparent",
  metadata: { nestable: true },
};
```

```js
// url=https://www.figma.com/design?node-id=7699-6921
// source=src/components/Parent.js
// component=Parent

const figma = require("figma");
const instance = figma.selectedInstance;

let childCode;
let special;
const node = instance.findConnectedInstance("child");
if (node && node.type === 'INSTANCE') {
  const { metadata, example } = node.executeTemplate();
  childCode = example;
  special = `<wow-special>${metadata.props.special}</wow-special>`;
}

export default {
  example: figma.html`<ds-parent>
${childCode}
</ds-parent>`,
  id: "parent",
  metadata: { nestable: true, props: { special } },
};
```

```js
// url=https://www.figma.com/design?node-id=7699-6922
// source=src/components/Child.js
// component=Child

const figma = require("figma");

export default {
  example: figma.html`<ds-child>normal stuff</ds-child>`,
  id: "child",
  metadata: { nestable: true, props: { special: "Special Stuff!!! 🤩" } },
};
```

```html
<!-- Child snippet: -->
<ds-child>normal stuff</ds-child>

<!-- Parent snippet: -->
<ds-parent>
  <ds-child>normal stuff</ds-child>
</ds-parent>

<!-- Grandparent snippet: -->
<ds-grandparent>
  <wow-special>Special Stuff!!! 🤩</wow-special> index: 0
  <wow-special>Special Stuff!!! 🤩</wow-special> index: 1
  <wow-special>Special Stuff!!! 🤩</wow-special> index: 2
</ds-grandparent>
```
