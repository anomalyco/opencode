# Keybindings vs. Keymappings

Make it `keymappings`, closer to neovim. Can be layered like `<leader>abc`. Commands don't define their binding, but have an id that a key can be mapped to like

```ts
{ key: "ctrl+w", cmd: string | function, description }
```

_Why_
Currently its keybindings that have an `id` like `message_redo` and then a command can use that or define it's own binding. While some keybindings are just used with `.match` in arbitrary key handlers and there is no info what the key is used for, except the binding id maybe. It also is unknown in which context/scope what binding is active, so a plugin like `which-key` is nearly impossible to get right.

## OpenTUI Keymap Migration

The v2 TUI uses `@opentui/keymap` as the key/cmd engine. The remaining legacy compatibility is config-only and exists to migrate users from `keybinds` to `keymap`:

- `packages/opencode/src/config/keybinds.ts`: old `keybinds` schema, defaults, and legacy key names.
- `packages/opencode/src/cli/cmd/tui/config/legacy-keymap-transform.ts`: transforms parsed legacy `keybinds` into OpenTUI `keymap` sections.
- `packages/opencode/src/cli/cmd/tui/config/tui-migrate.ts`: migrates legacy TUI keys from `opencode.json` into `tui.json`, including `theme`, `keybinds`, and nested `tui`.
- `packages/opencode/src/cli/cmd/tui/config/tui-schema.ts`: still accepts deprecated `keybinds` via `KeybindOverride` and marks it as deprecated. This file also contains the new `keymap` config schema.
- `packages/opencode/src/cli/cmd/tui/config/tui.ts`: parses legacy `keybinds`, applies the Windows `terminal_suspend`/`input_undo` adjustment, and uses `LegacyKeymapTransform.create(...)` as the fallback when no `keymap` section is configured.
- `packages/plugin/src/tui.ts`: plugin-facing `tuiConfig` still includes `keybinds` through `PluginConfig`; this should be removed when the public plugin API no longer exposes legacy config.

The transform must stay while users are migrating. It lets users upgrade without first rewriting their existing `keybinds` config. If `keymap` is configured, `keybinds` are ignored for keymap resolution. If `keymap` is missing, `legacy-keymap-transform.ts` turns legacy `keybinds` into the resolved `keymap` consumed by OpenTUI.

## Removing Legacy Later

When switching fully to the new config style, remove legacy support with these exact changes:

- Delete `packages/opencode/src/config/keybinds.ts`.
- Delete `packages/opencode/src/cli/cmd/tui/config/legacy-keymap-transform.ts`.
- Delete `packages/opencode/src/cli/cmd/tui/config/tui-migrate.ts`.
- In `packages/opencode/src/cli/cmd/tui/config/tui-schema.ts`, remove the `ConfigKeybinds` import, remove `KeybindOverride`, and delete the deprecated `keybinds` field from `TuiInfo`.
- In `packages/opencode/src/cli/cmd/tui/config/tui.ts`, remove `migrateTuiConfig(...)`, remove `ConfigKeybinds`, remove the Windows legacy keybind adjustment, remove `LegacyKeymapTransform.create(...)`, and require/default `keymap` through the new config path instead.
- In `packages/opencode/src/cli/cmd/tui/config/tui.ts`, remove `keybinds` from `Resolved`; resolved TUI config should expose `keymap` only.
- In `packages/plugin/src/tui.ts`, remove `keybinds` from plugin-facing `TuiConfigView`.
- Remove or rewrite tests that write or assert `keybinds`, especially in `packages/opencode/test/config/tui.test.ts`, `packages/opencode/test/fixture/tui-runtime.ts`, and TUI plugin loader tests.
