# U.2 keymap (`rs-ui-keymap`)

The TUI keymap layer: what `packages/tui/src/context/keymap.tsx` and `packages/tui/src/config/keybind.ts` do,
on top of opentui-rust's `opentui::keymap` (G.1). Rows K01, K02, K05, and K06.

## Files

- `script/gen/keybinds.ts` writes `crates/ui/src/keymap/generated.rs` from `TuiKeybind.Definitions`: the 244
  names in definition order, each default as JSON text, and each description. Names and defaults match by
  construction.
- `crates/ui/src/keymap/config.rs`: `Keybinds`, the resolved `keybinds` config (`TuiKeybind.parse`, the
  `terminal.suspend` rule of `config/index.tsx:295-305`, and `createBindingLookup` with the description
  default).
- `crates/ui/src/keymap/mod.rs`: `TuiKeymap<T>`, the Provider of `keymap.tsx:63-166` and its API.
- `parity/oracle/U.2-keymap.ts` and `parity/oracle/U.2-keymap/harness.ts`: the P-ORACLE.

## Config

`Keybinds::resolve(overrides, terminal_suspend)` takes the `keybinds` object as `serde_json` values, as F.5
reads `cli.json`:

- Unknown names fail with TS's text, `Unrecognized keybind(s): a, b`.
- A value is `false`, `"none"`, a key string, a key stroke object (`name` plus modifier flags), a binding object
  (`key`, `event`, `preventDefault`, `fallthrough`, and `desc` or `group`), or an array of items. Anything else
  fails with `Invalid keybind "<name>": <reason>` (TS's text comes from Effect Schema and is not copied).
- Without terminal suspend (Windows), `terminal.suspend` is `none` and an unset `input.undo` becomes
  `ctrl+z,ctrl+-,super+z`.
- Missing names take their default. Each binding without `desc` gets the name's description.

## TuiKeymap

`TuiKeymap::<T>::new(keybinds, options)` installs what the Provider installs, in the same order: comma
bindings, the `enter`/`esc`/`pgdown`/`pgup` aliases, base-layout fallback, Escape and Backspace editing of the
pending sequence, the managed textarea layer with the configured bindings of the 36 `input.*` names, and, when
`leader` has a binding, the timed leader with `leader.timeout` (2,000 ms by default).

- Focus: the app calls `set_focus(path)` on the inner `Keymap`. The managed textarea layer is enabled by
  `options.textarea_enabled`, and its commands call `options.textarea_run(EditorAction)`. While the condition
  holds, the app must not let the focused textarea handle keys itself (TS suspends it).
- Leader: the keymap has no clock. `leader_deadline()` says when to schedule a timer; the timer calls
  `expire_leader(now)`.
- Layers: `layer(KeymapLayer)` is `Keymap.createLayer`: a mode (`base` by default, `global` for none), an
  `enabled` condition, an optional target and priority, commands, and `bindings` (names whose configured keys
  join the layer). A named command binds its configured keys, else its `bind` string, unless `bind` is
  `false`; an inline command binds `bind` and runs only while enabled. `groupCommands`' shape checks return
  errors.
- Modes: `push_mode(mode, active)` and `mode()`. The current mode is the newest active entry, else `base`; it
  is published as the `opencode.mode` data value, which layers require. `handle_key` and `dispatch` publish it
  first, because `active` conditions are closures, not signals.
- `dispatch(id, input)` runs a reachable command and passes `input` to its handler.
- Queries: `commands()` (reachable, with the command metadata), `shortcut`, `shortcut_all`, `shortcuts`
  (formatted as `formatOptions` does: arrows, `pgup`, `pgdn`, `del`, `alt`, leader as its key), `pending()`,
  `leader_active()`, `is_leader(event)`.

Not ported: the Solid stable-object cache (`sameData`), the interactivity context (callers fold it into
`enabled`), and `active()` (the which-key data has no user in `packages/tui/src`, K05).

## Proof (P-ORACLE)

The harness renders the real `Keymap.Provider` with config from the real `resolve` in `testRender`, registers
commands that record their IDs, and feeds raw terminal bytes. Each case is a list of byte strings (and waits)
and the commands it ran. Bytes come from the configured sequences (`getCommandBindings`), encoded as Kitty
CSI-u and, where a legacy encoding exists, as legacy bytes. Scenarios:

- `isolated`: one named command at a time in a base layer, each of its configured sequences.
- `all`: all named commands but `leader` in one base layer, with and without a focused textarea, every
  configured sequence, plus leader timeout, Escape, and Backspace cases.
- An override corpus: every value form, aliases, a custom leader, `none` and `false`, Windows suspend, and
  unknown names (the error text).

The Rust test feeds the same bytes through `opentui::input::Parser` into `TuiKeymap` and must report the same
commands. Cases that differ only because of the parser's legacy `\n` and keypad reports (G.9) are listed in
the report and expected to fail until G.9 lands.
