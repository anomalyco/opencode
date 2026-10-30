# Componentize repeated and reusable elements

Componentization is part of the **default** workflow, not an optional follow-up. Produce a componentized structure on the first pass — do not emit a flat tree of one-off frames and wait for a second "now make it componentized" prompt.

- **Design-system instances are already componentized.** Where Step 2 found a published component, instancing it satisfies this and is the preferred path.
- **For anything the design system does not cover, create a local component when the element repeats or maps to a reusable source component.** If the source defines a reusable component (`<ListRow>`, `<StatCard>`, `<NavItem>`) or the same element appears more than once, build it **once** with `figma.createComponent()`, then place instances with `.createInstance()` and override per-instance content — instead of hand-building N near-identical frames.
- **Mirror the source's component boundaries.** One source component maps to one Figma main component. This keeps the output editable and matches what designers expect to receive.

```js
// Build the reusable element ONCE as a main component...
const row = figma.createComponent();
row.name = "List Row";
row.layoutMode = "HORIZONTAL";
// ...load fonts, then add its auto-layout, children, and text here...

// ...then place instances and override per-item content instead of rebuilding frames.
for (const item of items) {
  const inst = row.createInstance();
  // override text/props on inst (see setProperties / characters patterns above)
  listContainer.appendChild(inst);
}
```

Keep the main component off to the side of the wrapper (or in a dedicated components area) and place only **instances** inside the view, exactly as you do with design-system components.
