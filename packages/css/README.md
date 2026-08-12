# @opencode-ai/css

OpenCode's design system as plain CSS. It has no JavaScript, framework, build tool, or runtime dependency.

Use semantic HTML and `data-*` attributes. Native browser states such as `:hover`, `:focus-visible`, and `:disabled` work automatically; your JavaScript can represent application state with attributes such as `data-expanded`, `data-checked`, and `data-invalid`.

## Install

```sh
npm install @opencode-ai/css
```

Load the complete design system from JavaScript:

```js
import "@opencode-ai/css"
```

Or from CSS:

```css
@import "@opencode-ai/css";
```

For a static page with no package tooling:

```html
<link rel="stylesheet" href="https://unpkg.com/@opencode-ai/css/index.css" />
```

Add `data-oc-root` to the element that should receive the default page background, text color, and font. Set `data-color-scheme` to `light` or `dark` on that element or an ancestor.

```html
<body data-oc-root data-color-scheme="dark">
  <button data-component="button" data-variant="neutral" data-size="normal">Deploy</button>
</body>
```

## Selective imports

The default export contains every component. Small pages can load only what they use:

```css
@import "@opencode-ai/css/tokens.css";
@import "@opencode-ai/css/base.css";
@import "@opencode-ai/css/components/button.css";
@import "@opencode-ai/css/components/badge.css";
@import "@opencode-ai/css/components/table.css";
```

`tokens.css` defines the color ramps and semantic theme variables. `base.css` is intentionally small and scoped: it only applies the full-page defaults to `[data-oc-root]` and normalization to design-system elements.

## Common components

### Button

```html
<button data-component="button" data-variant="contrast" data-size="normal">Create release</button>
<button data-component="button" data-variant="danger" data-size="small">Delete</button>
<button data-component="button" data-variant="ghost" data-size="small" disabled>Disabled</button>
```

Variants: `neutral`, `contrast`, `outline`, `ghost`, `ghost-muted`, `danger`, `warning`, and `loading`. Sizes: `small`, `normal`, and `large`.

### Badge

```html
<span data-component="badge">Inactive</span> <span data-component="badge" data-variant="accent">Active</span>
```

### Internal-tool page

```html
<main data-component="page">
  <header data-slot="page-header">
    <div data-slot="page-heading">
      <p data-slot="page-eyebrow">Release control</p>
      <h1 data-slot="page-title">Artifacts</h1>
    </div>
  </header>

  <section data-component="surface" data-padding="none">
    <header data-slot="surface-header">
      <h2 data-slot="surface-title">Published builds</h2>
      <p data-slot="surface-description">Newest first.</p>
    </header>
    <div data-slot="surface-content">
      <div data-component="table-container">
        <table data-component="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-numeric>cli@1.0.0</td>
              <td><span data-component="badge" data-variant="accent">Active</span></td>
              <td data-align="end">
                <button data-component="button" data-variant="neutral" data-size="small">Activate</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</main>
```

### JavaScript-owned state

The package styles state; it does not implement behavior. Keep semantic HTML and ARIA as the source of truth, then mirror state to a `data-*` attribute when a component needs it.

```js
const trigger = document.querySelector('[data-component="button"]')
trigger.addEventListener("click", () => {
  const expanded = trigger.getAttribute("aria-expanded") !== "true"
  trigger.setAttribute("aria-expanded", String(expanded))
  trigger.toggleAttribute("data-expanded", expanded)
})
```

## Theme customization

Override semantic tokens at your app root instead of editing component CSS:

```css
[data-oc-root] {
  --oc-font-family-sans: Inter, system-ui, sans-serif;
  --oc-page-max-width: 1440px;
  --oc-bg-accent: #7152f4;
  --oc-border-focus: #8271f8;
}
```

The low-level color ramps live in `colors.css`; light and dark semantic mappings live in `theme.css`.

## Component inventory

The first release is intentionally focused on simple internal tools:

- Layout: page, surface, and table
- Actions and status: button and badge
- Forms: field, input, select, textarea, and native checkbox/radio styling
- Structure: divider

Each stylesheet is available as `@opencode-ai/css/components/<name>.css`. This small interface avoids publishing framework-specific DOM contracts for menus, dialogs, comboboxes, and other interactive widgets.

## Scope

This package is styling only. It does not create DOM, manage focus, provide keyboard navigation, position overlays, or add ARIA attributes. Use native HTML for simple controls and a small behavior layer of your choice for menus, dialogs, comboboxes, and other interactive widgets.

`@opencode-ai/ui` does not depend on this package yet. The CSS is intentionally isolated while its public interface settles.
