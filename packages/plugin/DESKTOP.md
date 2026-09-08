# Desktop extensions — exploratory API

This draft adds a renderer entrypoint at `@opencode/plugin/desktop` and a trusted main entrypoint at `@opencode/plugin/desktop/main`. Built-in registrations and installed `.ocdx` archives run through the same contracts. Settings → Extensions, grouped with Experimental, ports the OCDX manager: browse/drop archives, install from a URL, enable/disable, and reload across open windows. Server MCPs, plugins, and skills live under Settings → Tools.

## Contributions

Active routes expose `session.services`: workspace file caches and selection,
draft attachments, annotations, tab references, scroll state, and panel/sidebar
layout controls. These services exist while the session route is mounted. Stable
session identity and the public client remain available while its shell tab is open.
Feature queries stay in the extension and use TanStack Query.

Panels can use a shared `reference` (for example a `file://` resource) so existing
document producers can select them. `initial: "closed"` separates availability from
opening, `default` selects a fallback, and `closable: false` declares a pinned panel.
`view.tabs.canClose(reference)` lets a feature count user-opened tabs without knowing
which extensions supply pinned defaults. The host retains activated `group` content
while a declaration in that group exists, so replacing a file preview preserves its
surrounding sidebar. Group identity includes the server and session.

Session controls can use `session.header.actions`, `session.panel.toolbar`,
`session.panel.tools`, and `session.sidebar`. Each receives the session input and
uses the shared placement rules. Renderer contexts also expose shared translations,
notifications, file export, and available native path actions.

```tsx
import { Plugin } from "@opencode/plugin/desktop"
import { Panel, NativeSurface } from "@opencode/plugin/desktop/solid"

export default Plugin.define({
  id: "opencode.browser",
  setup(ctx) {
    ctx.ui.slot({
      append: "session.panel",
      when: () => available(),
      render: ({ session }) => (
        <Panel id={tab.id} title={tab.title} onClose={close}>
          <NativeSurface id={surfaceID} />
        </Panel>
      ),
    })
  },
})
```

Slots share the TUI resolver and its `append`, `prepend`, `before`, `after`, and `replace` rules. The plugin controls `when`, commands, and opening. Panel IDs are scoped to the plugin. Multiple reactive `Panel` instances share the host's ordered, closable tab strip. Closing, hiding, and disposing content are separate operations. Panel declarations live with the session route, even when the panel is closed.

Use the host's UI components directly. `@opencode/ui/layout` supplies shared layout, toolbar, form, text, and settings-row components. The browser companion in the next layer uses these components rather than shipping private CSS. Solid and TanStack remain normal libraries; the SDK adds no query framework.

## Lifetimes and data

- `ctx.sessions.list()` contains sessions visited by each open shell tab, retaining child-session ownership across navigation. `current()` is the currently routed session.
- Every session carries stable server, shell-tab, and session identities. Its server provides the existing client and reactive data APIs.
- `ctx.lifecycle.own` owns custom cleanup; its signal aborts on unload. Slots, commands and main RPC subscriptions are owned automatically.
- `storage.store` uses the host's persistence and cross-window synchronization. `storage.memory` retains window-local values across extension reloads. Schema-specific migrations remain an open API design item.
- `commands.register` accepts a reactive command list and registers with the existing command palette, keyboard, and slash-command host. IDs are plugin-scoped.
- `i18n` resolves existing host keys through the active language. Extension-owned translation catalogs are a follow-up.

## Installation and live reload

The manager stores manifests, archive files, enabled state, and activation generations
in Desktop's SQLite database. Installing a replacement or reloading an unchanged
archive advances its generation. Open windows replace that plugin's contributions,
dispose its commands/listeners/styles/native surfaces, and retain its extension storage.
Failed module loads keep the previous renderer definition available and appear in the
manager. Built-in IDs are reserved and their switches are read-only.

Archives target this SDK with `schema: "opencode.desktop/1"`; rebuild earlier OCDX
extensions for the new renderer and main entrypoints. `manifest.json` identifies the
extension, CommonJS entrypoints, and shared imports. The host supplies its own Solid,
Query, client, schema, and shared UI module instances. Other dependencies are bundled
by the packer. Pack from this repository:

```sh
bun packages/plugin/script/desktop-pack.ts --manifest manifest.json --renderer index.tsx --main main.ts --assets assets --out extension.ocdx
```

The input manifest contains `id`, `name`, and `version`. `--main` and `--assets` are
optional. `ctx.assets.url("assets/icon.png")` resolves an installed archive asset.
The runtime is trusted in-process code; installation adds no sandbox or app restart.

## Local main entrypoint

`MainPlugin.define({ id, rpc, setup })` uses a public `Rpc.define` contract. Inputs, outputs and events are decoded/encoded at the bridge. Effect codecs can carry bytes over the JSON envelope, and Standard Schema/JSON Schema are supported. Methods receive a cancellation signal. Null is the void wire value.

Main context exposes the owning Electron window, a lifecycle, authenticated Node-side OpenCode clients for host-known server IDs, and a native surface registrar. It does not import Core. A renderer calls `ctx.main.rpc(contract)` and subscribes to its events.

`ctx.surfaces.register(view)` returns an opaque, window/extension-owned ID. `<NativeSurface id={id} />` presents that view. The host owns bounds, zoom conversion, corner composition, and menu/dialog occlusion. The extension owns the view's domain behavior and disposal.

## Verification

Production parent-branch comparisons are recorded in the draft PR bodies. The measurements use isolated fixtures and do not set machine-independent thresholds.

Focused tests cover lifecycle teardown, codec validation and binary round trips, shared slot ordering, and actual application panel behavior through an independent fixture plugin. The dependent browser extraction exercises native surfaces and server RPC.
