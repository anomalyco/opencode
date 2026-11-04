# Plugin source authoring

Use this reference when producing complete `code.ts` and `ui.html` replacements for `update_generative_plugin`.

## Contents

- [Deployment boundary](#deployment-boundary)
- [Plan the product contract](#plan-the-product-contract)
- [Entrypoint and UI lifecycle](#entrypoint-and-ui-lifecycle)
- [PropsKit UI](#propskit-ui)
- [Dynamic-page-compatible Plugin API](#dynamic-page-compatible-plugin-api)
- [Authoring rules](#authoring-rules)
- [Pre-build checklist](#pre-build-checklist)

## Deployment boundary

The MCP update accepts a `files` array containing complete replacements for existing authored files:

```json
[
  { "path": "code.ts", "content": "<complete TypeScript entrypoint>" },
  { "path": "ui.html", "content": "<complete plugin UI>" }
]
```

It can replace `code.ts` and `ui.html`. It cannot replace `manifest.json`, create a missing file, or accept a diff. Unspecified files are preserved, so include only files that changed. A metadata-only update can use an empty `files` array with `metadata.name` and/or `metadata.description`.

After create/get:

1. Read the manifest, UI, and current entrypoint URIs.
2. Verify the manifest targets `editorType: ["figma"]`, includes functional UI, and uses dynamic-page access.
3. Preserve the existing UI message contract when it fits the requested workflow.
4. When different controls are required, replace `ui.html` and update `code.ts` so their message contracts agree.
5. If the existing manifest itself is incompatible and the requested behavior requires changing it, surface that limitation; `update_generative_plugin` cannot repair it.

Do not add imports, extra source files, build configuration, or dependencies that the tool cannot deploy.

## Plan the product contract

Before coding, define:

- The primary action and whether it creates, transforms, or inspects layers.
- Required selection and input states.
- UI controls, defaults, validation, and status copy.
- Messages sent UI → sandbox and sandbox → UI.
- Which operations are repeatable and which close the plugin.
- The exact created/modified layers, placement, selection, and viewport behavior.
- Maximum expected work and how it is bounded.
- Whether relaunch data or lightweight persisted preferences are useful.

Every plugin needs functional UI. Even a zero-parameter operation needs a clear primary button plus useful disabled/error/success feedback.

## Entrypoint and UI lifecycle

The sandbox is the only side that can call `figma.*`. The UI iframe is the only side that can use DOM/browser APIs. Communicate exclusively through messages.

`code.ts` owns Plugin API calls and loads the separate UI with `__html__`:

```ts
const PANEL_WIDTH = 280

type UiMessage =
  | { type: 'resize'; height: number }
  | { type: 'run'; count: number }

figma.showUI(__html__, { width: PANEL_WIDTH, height: 240 })

figma.ui.onmessage = async (message: UiMessage) => {
  if (message.type === 'resize') {
    figma.ui.resize(PANEL_WIDTH, Math.max(120, Math.min(900, Math.round(message.height))))
    return
  }
  if (message.type === 'run') {
    // Validate, mutate, report status. Close only for a genuinely one-shot flow.
  }
}
```

`ui.html` owns the DOM and sends messages to the sandbox:

```html
<!doctype html>
<html>
<head>
  <script>
    try {
      window.localStorage.getItem('x')
    } catch (e) {
      const store = new Map()
      const shim = {
        getItem: (key) => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => { store.set(key, String(value)) },
        removeItem: (key) => { store.delete(key) },
        clear: () => { store.clear() },
        key: (index) => Array.from(store.keys())[index] ?? null,
        get length() { return store.size },
      }
      Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })
    }
  </script>
</head>
<body>
  <div id="plugin-root">
    <fig-content>
      <fig-field>
        <label>Count</label>
        <fig-input-number id="count" value="3" min="1" max="100"></fig-input-number>
      </fig-field>
    </fig-content>
    <fig-footer>
      <label id="status">Ready</label>
      <fig-button id="run" type="submit">Create layers</fig-button>
    </fig-footer>
  </div>
  <script>
    const post = (message) => parent.postMessage({ pluginMessage: message }, '*')
    document.getElementById('run').addEventListener('click', () => {
      post({ type: 'run', count: Number(document.getElementById('count').value) })
    })
    const root = document.getElementById('plugin-root')
    new ResizeObserver(() => {
      post({ type: 'resize', height: Math.ceil(root.getBoundingClientRect().height) })
    }).observe(root)
  </script>
</body>
</html>
```

Do not close the plugin before asynchronous operations and messages finish. Keep it open for repeatable panels; close only after a one-shot action has completed or a terminal error is shown.

## PropsKit UI

Use PropsKit `fig-*` controls rather than raw HTML equivalents where available. Structure the panel as `<fig-content>` followed by `<fig-footer>`.

- Wrap controls in `<fig-field>` with a child `<label>`.
- Group related controls with `<fig-group name="…">`.
- Put status and actions in `<fig-footer>`; disable actions when selection/input requirements are unmet.
- Use sentence case for labels, groups, status, actions, notifications, and relaunch names.
- Use Figma's canonical property wording when a control maps directly to an editor property.
- Read `.value` at submit time unless live updates are part of the requested behavior.
- Prefer `change` over `input` to avoid scenegraph thrashing. For color/fill pickers, read on submit or deliberately listen to both.

Recommended controls:

| Input | Control |
| --- | --- |
| Bounded number | `<fig-slider text>` |
| Numeric input | `<fig-input-number>` |
| Text | `<fig-input-text>`; add `multiline` for long text |
| Color | `<fig-input-color picker="figma-native">` |
| Gradient | `<fig-input-gradient experimental="modern">` |
| Palette | `<fig-input-palette min="2" max="8">` |
| Boolean | `<fig-switch>` |
| Small choice set | `<fig-options options="A, B, C">` |
| Large choice set | `<fig-dropdown>` with direct `<option>` children |
| 2D point | `<fig-joystick fields>` |
| Image upload | `<fig-image upload>` |
| Other file upload | `<fig-input-file>` |
| Primary action | `<fig-button type="submit">` in `<fig-footer>` |

PropsKit-specific rules:

- `<fig-options>` receives comma-separated options; do not add child options.
- `<fig-dropdown>` receives `<option>` children directly; never nest an HTML `<select>`.
- `<fig-joystick>` values are `"X% Y%"` strings.
- Color values are hex; convert channels to normalized `0..1` values before creating paints.
- PropsKit gradient stop positions/opacities are `0..100`; Plugin API values are `0..1`.
- Use `<fig-image upload>` for previewable images and `<fig-input-file>` for CSV/JSON/text/binary.
- Style custom elements with Figma tokens (`--figma-color-*`, `--spacer-*`, `--font-family`) rather than fixed colors.

## Dynamic-page-compatible Plugin API

The create scaffold already uses dynamic-page access. Keep source compatible:

- Prefer `getNodeByIdAsync`, `getStyleByIdAsync`, local-style async getters, variable async getters, `getMainComponentAsync`, and `getInstancesAsync`.
- Use async setters such as `setFillStyleIdAsync`, `setStrokeStyleIdAsync`, `setEffectStyleIdAsync`, `setGridStyleIdAsync`, `setTextStyleIdAsync`, `setReactionsAsync`, and `setVectorNetworkAsync`.
- `figma.currentPage` is loaded. Before traversing another page's children, call `await page.loadAsync()`.
- Change pages with `await figma.setCurrentPageAsync(page)`, never assignment.
- Load all pages only for a true whole-document operation; it can be slow and memory-heavy.
- Handle every promise. Avoid `forEach(async ...)`; use `for...of` or bounded `Promise.all`.
- Do not bypass deprecated APIs with `as any` or computed property access.

If the fetched manifest lacks dynamic-page access, write source using the compatible APIs anyway, but do not claim the manifest was migrated—the MCP update cannot modify it.

## Authoring rules

### Fonts

Call `await figma.loadFontAsync(fontName)` before changing text characters or font-dependent properties. For mixed fonts, inspect ranges and load every required face. Do not assume non-default fonts exist; handle unavailable fonts with a useful status/error message.

### Paints and immutable arrays

- Fills, strokes, and effects are immutable arrays: clone, change, and reassign.
- Colors use normalized `0..1` RGB. Paint alpha belongs in `opacity`.
- `setBoundVariableForPaint` returns a new paint; capture and reassign it.
- Gradient values from PropsKit require conversion to Plugin API gradient types and normalized stops.

### Geometry and placement

- Resize with `node.resize(width, height)`; `width` and `height` are read-only.
- `resize()` may reset auto-layout sizing modes; reapply the intended sizing afterward.
- Reparenting preserves relative `x`/`y` values. Set coordinates after `appendChild`, `insertChild`, or grouping into a new parent.
- Place new top-level output near `figma.viewport.center`, not at the page origin.
- Select/reveal only the meaningful result. Avoid unexpectedly pulling the viewport away from the user's work.
- Import icons from SVG with `figma.createNodeFromSvg`; do not reconstruct them from rotated primitive lines.

### Selection and validation

- Validate selection count and layer capabilities before mutating.
- Use capability guards such as `'fills' in node`; assigning unsupported fields throws.
- Disable UI actions when possible and revalidate in the sandbox because selection can change after the panel renders.
- Preserve unrelated children and properties. Track and update only output owned by the plugin.
- Make destructive behavior explicit in the UI and user-facing copy.

### Bounded work

- Clamp user-supplied counts and dimensions.
- Avoid unbounded traversal or quadratic pairwise work.
- For large operations, process in chunks and send progress/status messages.
- Do not use authenticated network calls or embed secrets. Source is readable to people with access.
- Public no-auth endpoints are acceptable only when the request genuinely requires them and the endpoint permits browser access.

### Relaunch and persistence

Every plugin must be re-runnable. Call `figma.root.setRelaunchData(...)` when the plugin opens so it remains discoverable when nothing is selected. After a run creates or modifies a layer, also attach relaunch data to the outermost affected layer—such as the selected parent or newly created top-level frame—not each generated child.

Persist only small, non-sensitive preferences with plugin data. Do not persist uploaded files, credentials, stale selection-derived IDs, or destructive confirmations. Keep schemas versioned and tolerate missing/old data.

## Pre-build checklist

Before calling `update_generative_plugin`, check:

1. Every `files` entry contains complete replacement content for existing `code.ts` or `ui.html`.
2. The fetched manifest constraints are understood and no undeployable manifest or new-file changes are implied.
3. The plugin has functional UI and a clear primary action.
4. UI and sandbox message types agree exactly.
5. Input and selection states are validated on both sides where appropriate.
6. Every async API is awaited and dynamic-page rules are followed.
7. Fonts are loaded before text mutation.
8. Paint arrays are cloned/reassigned and colors are normalized.
9. Reparented/new output has intentional coordinates and viewport placement.
10. Work is bounded and no secrets are embedded.
11. Success/error/status behavior is user-visible and uses “plugin” and “layer,” not internal jargon.
12. The plugin stays open or closes according to the actual interaction model.

On a build error, fix the reported source issue with the smallest change and retry once.
