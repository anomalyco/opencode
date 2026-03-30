# TUI plugins

Technical reference for the current TUI plugin system.

## Overview

- TUI plugin config lives in `tui.json`.
- Author package entrypoint is `@opencode-ai/plugin/tui`.
- Internal plugins load inside the CLI app the same way external TUI plugins do.
- Package plugins can be installed from CLI or TUI.
- v1 plugin modules are target-exclusive: a module can export `server` or `tui`, never both.
- Server runtime keeps v0 legacy fallback (function exports / enumerated exports) after v1 parsing.

## TUI config

Example:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "smoke-theme",
  "plugin": ["@acme/opencode-plugin@1.2.3", ["./plugins/demo.tsx", { "label": "demo" }]],
  "plugin_enabled": {
    "acme.demo": false
  }
}
```

- `plugin` entries can be either a string spec or `[spec, options]`.
- Plugin specs can be npm specs, `file://` URLs, relative paths, or absolute paths.
- Relative path specs are resolved relative to the config file that declared them.
- A file module listed in `tui.json` must be a TUI module (`default export { id?, tui }`) and must not export `server`.
- Duplicate npm plugins are deduped by package name; higher-precedence config wins.
- Duplicate file plugins are deduped by exact resolved file spec. This happens while merging config, before plugin modules are loaded.
- `plugin_enabled` is keyed by plugin id, not by plugin spec.
- For file plugins, that id must come from the plugin module's exported `id`. For npm plugins, it is the exported `id` or the package name if `id` is omitted.
- Plugins are enabled by default. `plugin_enabled` is only for explicit overrides, usually to disable a plugin with `false`.
- `plugin_enabled` is merged across config layers.
- Runtime enable/disable state is also stored in KV under `plugin_enabled`; that KV state overrides config on startup.

## Author package shape

Package entrypoint:

- Import types from `@opencode-ai/plugin/tui`.
- `@opencode-ai/plugin` exports `./tui` and declares optional peer deps on `@opentui/core` and `@opentui/solid`.

Minimal module shape:

```tsx
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api, options, meta) => {
  api.command.register(() => [
    {
      title: "Demo",
      value: "demo.open",
      onSelect: () => api.route.navigate("demo"),
    },
  ])

  api.route.register([
    {
      name: "demo",
      render: () => (
        <box>
          <text>demo</text>
        </box>
      ),
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id: "acme.demo",
  tui,
}

export default plugin
```

- Loader only reads the module default export object. Named exports are ignored.
- TUI shape is `default export { id?, tui }`; including `server` is rejected.
- A single module cannot export both `server` and `tui`.
- `tui` signature is `(api, options, meta) => Promise<void>`.
- If package `exports` contains `./tui`, the loader resolves that entrypoint. Otherwise it uses the resolved package target.
- If a package supports both server and TUI, use separate files and package `exports` (`./server` and `./tui`) so each target resolves to a target-only module.
- File/path plugins must export a non-empty `id`.
- npm plugins may omit `id`; package `name` is used.
- Runtime identity is the resolved plugin id. Later plugins with the same id are rejected, including collisions with internal plugin ids.
- If a path spec points at a directory, that directory must have `package.json` with `main`.
- There is no directory auto-discovery for TUI plugins; they must be listed in `tui.json`.

## Package manifest and install

Package manifest is read from `package.json` field `oc-plugin`.

Example:

```json
{
  "name": "@acme/opencode-plugin",
  "type": "module",
  "main": "./dist/index.js",
  "engines": {
    "opencode": "^1.0.0"
  },
  "oc-plugin": [
    ["server", { "custom": true }],
    ["tui", { "compact": true }]
  ]
}
```

### Version compatibility

npm plugins can declare a version compatibility range in `package.json` using the standard `engines` field:

```json
{
  "engines": {
    "opencode": "^1.0.0"
  }
}
```

- The value is a semver range checked against the running OpenCode version.
- If the range is not satisfied, the plugin is skipped with a warning and a session error.
- If `engines.opencode` is absent, no check is performed (backward compatible).
- File plugins are never checked; only npm package plugins are validated.

- Install flow is shared by CLI and TUI in `src/plugin/install.ts`.
- Shared helpers are `installPlugin`, `readPluginManifest`, and `patchPluginConfig`.
- `opencode plugin <module>` and TUI install both run install → manifest read → config patch.
- Alias: `opencode plug <module>`.
- `-g` / `--global` writes into the global config dir.
- Local installs resolve target dir inside `patchPluginConfig`.
- For local scope, path is `<worktree>/.opencode` only when VCS is git and `worktree !== "/"`; otherwise `<directory>/.opencode`.
- Root-worktree fallback (`worktree === "/"` uses `<directory>/.opencode`) is covered by regression tests.
- `patchPluginConfig` applies all declared manifest targets (`server` and/or `tui`) in one call.
- `patchPluginConfig` returns structured result unions (`ok`, `code`, fields by error kind) instead of custom thrown errors.
- `patchPluginConfig` serializes per-target config writes with `Flock.acquire(...)`.
- `patchPluginConfig` uses targeted `jsonc-parser` edits, so existing JSONC comments are preserved when plugin entries are added or replaced.
- Without `--force`, an already-configured npm package name is a no-op.
- With `--force`, replacement matches by package name. If the existing row is `[spec, options]`, those tuple options are kept.
- Tuple targets in `oc-plugin` provide default options written into config.
- A package can target `server`, `tui`, or both.
- If a package targets both, each target must still resolve to a separate target-only module. Do not export `{ server, tui }` from one module.
- There is no uninstall, list, or update CLI command for external plugins.
- Local file plugins are configured directly in `tui.json`.

When `plugin` entries exist in a writable `.opencode` dir or `OPENCODE_CONFIG_DIR`, OpenCode installs `@opencode-ai/plugin` into that dir and writes:

- `package.json`
- `bun.lock`
- `node_modules/`
- `.gitignore`

That is what makes local config-scoped plugins able to import `@opencode-ai/plugin/tui`.

## TUI plugin API

Top-level API groups exposed to `tui(api, options, meta)`:

- `api.app.version`
- `api.command.register(cb)` / `api.command.trigger(value)`
- `api.route.register(routes)` / `api.route.navigate(name, params?)` / `api.route.current`
- `api.ui.Dialog`, `DialogAlert`, `DialogConfirm`, `DialogPrompt`, `DialogSelect`, `Prompt`, `ui.toast`, `ui.dialog`
- `api.keybind.match`, `print`, `create`
- `api.tuiConfig`
- `api.kv.get`, `set`, `ready`
- `api.state`
- `api.theme.current`, `selected`, `has`, `set`, `install`, `mode`, `ready`
- `api.client`, `api.scopedClient(workspaceID?)`, `api.workspace.current()`, `api.workspace.set(workspaceID?)`
- `api.event.on(type, handler)`
- `api.renderer`
- `api.slots.register(plugin)`
- `api.plugins.list()`, `activate(id)`, `deactivate(id)`, `add(spec)`, `install(spec, options?)`
- `api.lifecycle.signal`, `api.lifecycle.onDispose(fn)`

### Commands

`api.command.register` returns an unregister function. Command rows support:

- `title`, `value`
- `description`, `category`
- `keybind`
- `suggested`, `hidden`, `enabled`
- `slash: { name, aliases? }`
- `onSelect`

Command behavior:

- Registrations are reactive.
- Later registrations win for duplicate `value` and for keybind handling.
- Hidden commands are removed from the command dialog and slash list, but still respond to keybinds and `command.trigger(value)` if `enabled !== false`.

### Routes

- Reserved route names: `home` and `session`.
- Any other name is treated as a plugin route.
- `api.route.current` returns one of:
  - `{ name: "home" }`
  - `{ name: "session", params: { sessionID, initialPrompt? } }`
  - `{ name: string, params?: Record<string, unknown> }`
- `api.route.navigate("session", params)` only uses `params.sessionID`. It cannot set `initialPrompt`.
- If multiple plugins register the same route name, the last registered route wins.
- Unknown plugin routes render a fallback screen with a `go home` action.

### Dialogs and toast

- `ui.Dialog` is the base dialog wrapper.
- `ui.DialogAlert`, `ui.DialogConfirm`, `ui.DialogPrompt`, `ui.DialogSelect` are built-in dialog components.
- `ui.Prompt` renders the same prompt component used by the host app.
- `ui.toast(...)` shows a toast.
- `ui.dialog` exposes the host dialog stack:
  - `replace(render, onClose?)`
  - `clear()`
  - `setSize("medium" | "large" | "xlarge")`
  - readonly `size`, `depth`, `open`

### Keybinds

- `api.keybind.match(key, evt)` and `print(key)` use the host keybind parser/printer.
- `api.keybind.create(defaults, overrides?)` builds a plugin-local keybind set.
- Only missing, blank, or non-string overrides are ignored. Key syntax is not validated.
- Returned keybind set exposes `all`, `get(name)`, `match(name, evt)`, `print(name)`.

### KV, state, client, events

- `api.kv` is the shared app KV store backed by `state/kv.json`. It is not plugin-namespaced.
- `api.kv` exposes `ready`.
- `api.tuiConfig` and `api.state` are live host objects/getters, not frozen snapshots.
- `api.state` exposes synced TUI state:
  - `ready`
  - `config`
  - `provider`
  - `path.{state,config,worktree,directory}`
  - `vcs?.branch`
  - `workspace.list()` / `workspace.get(workspaceID)`
  - `session.count()`
  - `session.diff(sessionID)`
  - `session.todo(sessionID)`
  - `session.messages(sessionID)`
  - `session.status(sessionID)`
  - `session.permission(sessionID)`
  - `session.question(sessionID)`
  - `part(messageID)`
  - `lsp()`
  - `mcp()`
- `api.client` always reflects the current runtime client.
- `api.scopedClient(workspaceID?)` creates or reuses a client bound to a workspace.
- `api.workspace.set(...)` rebinds the active workspace; `api.client` follows that rebind.
- `api.event.on(type, handler)` subscribes to the TUI event stream and returns an unsubscribe function.
- `api.renderer` exposes the raw `CliRenderer`.

### Theme

- `api.theme.current` exposes the resolved current theme tokens.
- `api.theme.selected` is the selected theme name.
- `api.theme.has(name)` checks for an installed theme.
- `api.theme.set(name)` switches theme and returns `boolean`.
- `api.theme.mode()` returns `"dark" | "light"`.
- `api.theme.install(jsonPath)` installs a theme JSON file.
- `api.theme.ready` reports theme readiness.

Theme install behavior:

- Relative theme paths are resolved from the plugin root.
- Theme name is the JSON basename.
- First install writes only when the destination file is missing.
- If the theme name already exists, install is skipped unless plugin metadata state is `updated`.
- On `updated`, host only rewrites themes previously tracked for that plugin and only when source `mtime`/`size` changed.
- Local plugins persist installed themes under the local `.opencode/themes` area near the plugin config source.
- Global plugins persist installed themes under the global `themes` dir.
- Invalid or unreadable theme files are ignored.

### Slots

Current host slot names:

- `app`
- `home_logo`
- `home_prompt` with props `{ workspace_id? }`
- `home_bottom`
- `sidebar_title` with props `{ session_id, title, share_url? }`
- `sidebar_content` with props `{ session_id }`
- `sidebar_footer` with props `{ session_id }`

Slot notes:

- Slot context currently exposes only `theme`.
- `api.slots.register(plugin)` returns the host-assigned slot plugin id.
- `api.slots.register(plugin)` does not return an unregister function.
- Returned ids are `pluginId`, `pluginId:1`, `pluginId:2`, and so on.
- Plugin-provided `id` is not allowed.
- The current host renders `home_logo` and `home_prompt` with `replace`, `sidebar_title` and `sidebar_footer` with `single_winner`, and `app`, `home_bottom`, and `sidebar_content` with the slot library default mode.
- Plugins cannot define new slot names in this branch.

### Plugin control and lifecycle

- `api.plugins.list()` returns `{ id, source, spec, target, enabled, active }[]`.
- `enabled` is the persisted desired state. `active` means the plugin is currently initialized.
- `api.plugins.activate(id)` sets `enabled=true`, persists it into KV, and initializes the plugin.
- `api.plugins.deactivate(id)` sets `enabled=false`, persists it into KV, and disposes the plugin scope.
- `api.plugins.add(spec)` trims the input and returns `false` for an empty string.
- `api.plugins.add(spec)` treats the input as the runtime plugin spec and loads it without re-reading `tui.json`.
- `api.plugins.add(spec)` no-ops when that resolved spec (or resolved plugin id) is already loaded.
- `api.plugins.add(spec)` assumes enabled and always attempts initialization (it does not consult config/KV enable state).
- `api.plugins.install(spec, { global? })` runs install -> manifest read -> config patch using the same helper flow as CLI install.
- `api.plugins.install(...)` returns either `{ ok: false, message, missing? }` or `{ ok: true, dir, tui }`.
- `api.plugins.install(...)` does not load plugins into the current session. Call `api.plugins.add(spec)` to load after install.
- For packages that declare a tuple `tui` target in `oc-plugin`, `api.plugins.install(...)` stages those tuple options so a following `api.plugins.add(spec)` uses them.
- If activation fails, the plugin can remain `enabled=true` and `active=false`.
- `api.lifecycle.signal` is aborted before cleanup runs.
- `api.lifecycle.onDispose(fn)` registers cleanup and returns an unregister function.

## Plugin metadata

`meta` passed to `tui(api, options, meta)` contains:

- `state`: `first | updated | same`
- `id`, `source`, `spec`, `target`
- npm-only fields when available: `requested`, `version`
- file-only field when available: `modified`
- `first_time`, `last_time`, `time_changed`, `load_count`, `fingerprint`

Metadata is persisted by plugin id.

- File plugin fingerprint is `target|modified`.
- npm plugin fingerprint is `target|requested|version`.
- Internal plugins get synthetic metadata with `state: "same"`.

## Runtime behavior

- Internal TUI plugins load first.
- External TUI plugins load from `tuiConfig.plugin`.
- `--pure` / `OPENCODE_PURE` skips external TUI plugins only.
- External plugin resolution and import are parallel.
- External plugin activation is sequential to keep command, route, and side-effect order deterministic.
- File plugins that fail initially are retried once after waiting for config dependency installation.
- Runtime add uses the same external loader path, including the file-plugin retry after dependency wait.
- Runtime add skips duplicates by resolved spec and returns `true` when the spec is already loaded.
- Runtime install and runtime add are separate operations.
- Plugin init failure rolls back that plugin's tracked registrations and loading continues.
- TUI runtime tracks and disposes:
  - command registrations
  - route registrations
  - event subscriptions
  - slot registrations
  - explicit `lifecycle.onDispose(...)` handlers
- Cleanup runs in reverse order.
- Cleanup is awaited.
- Total cleanup budget per plugin is 5 seconds; timeout/error is logged and shutdown continues.

## Built-in plugins

- `internal:home-tips`
- `internal:sidebar-context`
- `internal:sidebar-mcp`
- `internal:sidebar-lsp`
- `internal:sidebar-todo`
- `internal:sidebar-files`
- `internal:sidebar-footer`
- `internal:plugin-manager`

Sidebar content order is currently: context `100`, mcp `200`, lsp `300`, todo `400`, files `500`.

The plugin manager is exposed as a command with title `Plugins` and value `plugins.list`.

- Keybind name is `plugin_manager`.
- Default keybind is `none`.
- It lists both internal and external plugins.
- It toggles based on `active`.
- Its own row is disabled only inside the manager dialog.
- It also exposes command `plugins.install` with title `Install plugin`.
- Inside the Plugins dialog, key `shift+i` opens the install prompt.
- Install prompt asks for npm package name.
- Scope defaults to local, and `tab` toggles local/global.
- Install is blocked until `api.state.path.directory` is available; current guard message is `Paths are still syncing. Try again in a moment.`.
- Manager install uses `api.plugins.install(spec, { global })`.
- If the installed package has no `tui` target (`tui=false`), manager reports that and does not expect a runtime load.
- If install reports `tui=true`, manager then calls `api.plugins.add(spec)`.
- If runtime add fails, TUI shows a warning and restart remains the fallback.

## Current in-repo examples

- Local smoke plugin: `.opencode/plugins/tui-smoke.tsx`
- Local smoke config: `.opencode/tui.json`
- Local smoke theme: `.opencode/plugins/smoke-theme.json`
