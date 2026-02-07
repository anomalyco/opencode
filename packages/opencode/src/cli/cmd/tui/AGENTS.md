# TUI Agent Guidelines

## Context System

- All TUI contexts use `createSimpleContext` from `context/helper.tsx` which returns `{ use, provider }` — a hook and a JSX provider component.
- Provider tree ordering matters: a context provider can be high in the tree while its UI consumer renders deep inside `App` where other contexts (like `useSync`, `useTheme`) are available. Separate where state lives from where it's rendered.
- `RouteProvider` supports an external driver via `RouteDriverContext`. Wrapping `RouteProvider` with a driver provider lets you intercept `route.navigate()` and `route.data` without modifying RouteProvider itself. The tab system uses this pattern.

## Session Status

- `SessionStatus` from the SDK is only `idle | busy | retry`. There is no `error`, `done`, or `attention` type.
- To detect errors: check `message.error` on the last assistant message in `sync.data.message[sessionID]`.
- To detect "requires attention": check `sync.data.permission[sessionID]` and `sync.data.question[sessionID]` arrays.
- To detect "done/completed": the session is idle AND the last assistant message has `time.completed` set.
- The legacy `sync.session.status()` method derives state from messages (not `session_status`); prefer `sync.data.session_status[id]` for the real server-reported status.

## Persistent UI Preferences

- Use `useKV()` for persistent UI toggles. It reads/writes `kv.json` in the state directory.
- Pattern: `kv.get("key", defaultValue)` to read, `kv.set("key", value)` to write. Changes persist across sessions.
- Existing keys include `animations_enabled`, `diff_wrap_mode`, `terminal_title_enabled`, `tab_bar_visible`.

## Command Registration

- Register commands via `command.register(() => [...])` in `App`. Each command can have `keybind`, `slash`, `category`, `hidden`, `enabled`, and `suggested` properties.
- The `keybind` field must be a key of `KeybindsConfig` from the SDK types. Adding a new keybind requires updating `config.ts` and regenerating the SDK.
