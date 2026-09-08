# Built-in Desktop browser extension (draft)

This package is the Desktop companion to `@opencode/plugin-browser`. It imports the public Plugin, Client, Schema, UI and Electron APIs. Production code does not import App, Desktop, Core or Server internals.

- `.` is the renderer plugin: settings, availability, attachment lifetime, dynamic panel instances, and the browser toolbar.
- `./main` is the trusted native plugin: Chromium, CDP, diagnostics, file capture and remote networking.
- `./rpc` is its local renderer/main contract. The existing server-side `@opencode/plugin-browser/rpc` contract remains unchanged.

The host owns tab layout, selection, closing, keyboard interaction, and native-surface bounds/clipping/occlusion. The extension owns browser pages and protocol behavior. Its UI is composed from shared OpenCode components, including `Panel`, `NativeSurface`, `Toolbar`, `TextInput`, `IconButton`, `Switch` and `SettingsRow`.

## Ownership

Every visited session attaches eagerly while the extension's setting allows it. Attachments are owned by the shell tab and survive Settings and session-route changes, enabling agent-initiated browsing while the UI is hidden. Removing an owning shell tab or disabling the setting closes its attachments. A replacement by another Desktop is terminal rather than a reason to reclaim ownership.

The host resolves an authenticated Node-side client for the current server identity on each attachment attempt. Chromium requests still use the server-side tunnel. Request IDs, cancellation, state acknowledgements, explicit tab targeting, and bounded file transfer retain the existing browser protocol semantics.

## Exploration notes

This draft is statically registered as a built-in renderer and main extension. Third-party installation/discovery is a separate loader concern. The new extension-owned setting defaults off; the old host `experimentalBrowser` value is retained in storage, and a migration must be agreed before this becomes a production change. Existing host translation keys are reused byte-for-byte; plugin-owned translation catalogs are an API follow-up.

## Checks

- `bun typecheck` and `bun test` run from this package.
- `packages/desktop/test/browser-native.test.ts` exercises this package through the generic main extension host, the actual server plugin and real Chromium.
- The native suite covers all 44 browser operations, state-publication retries, file bytes crossing separate server/Desktop storage, and replacement handling.
