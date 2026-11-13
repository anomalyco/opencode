# F16: a plugin call that panics has no effects

## TypeScript

A TUI plugin's callbacks call the host directly, and nothing undoes a call: what a callback did before it threw
stays. A toast it showed stays on screen, a route it opened stays open, a request it sent goes out, a storage write
it made stays written.

- Setup that throws: the cleanups it registered run, the plugin is listed as failed, and a toast says
  `Plugin failed: <target>` (`packages/tui/src/plugin/context.tsx`, `setup` and the reconcile's failure toast).
- A command that throws: the keymap reports `command-execution-error` and the command returns an error result
  (`@opentui/keymap`, `executeResolvedCommand`). The plugin stays active and is not listed as failed.
- A render that throws (slot, route, dialog): `PluginBoundary` draws nothing in its place and toasts
  `Plugin: <id> crashed in <where>: <message>` (`packages/tui/src/plugin/api.tsx`). The plugin stays active.

## Rust

A plugin call runs as one unit, on both paths (built-ins in process and libraries over the C ABI), and through every
entry point: setup, commands, event handlers, fetch replies, wakes, slot and route mount handlers, and slot, route
and fence renders.

- What the call asked for waits until it returns. When it panics, all of it is dropped: toasts, attention, routes,
  navigation, dispatches, fetches, dialogs and copies. Storage writes still show to reads at once inside the call;
  after a panic, each written key gets back what it held before, and a key that held nothing is removed.
- The dispose callbacks a panicking setup runs are part of that call, so what they ask for is dropped too. A setup
  that fails without a panic keeps its effects, as in TS.
- A panic fails the plugin. It is not called again. Its commands leave the keymap, its slots and routes draw empty,
  and its fences fall back to the code view. The plugin manager lists it as failed with `<call> panicked: <message>`,
  and the toast `Plugin failed: <id>` says so, as for an external plugin that did not load. Enabling it again starts
  a new instance.

Built-ins were not covered before this change: only their setup caught a panic. A panic in a built-in's command,
render or handler unwound into the host.

## Reason

JavaScript has no transaction, so TS keeps the effects because it cannot undo them. Rust queues every effect until
the call returns, so it can apply the rule the plugin design sets (synthesis 4.5: a panicking call's effects are
dropped as a whole). A half-done call cannot leave a toast or a dialog for an action that did not happen, or a
storage value that the plugin's own invariants never allowed (spike SC found the dialog "LEAKED EFFECT" on screen
after a panic). Rust also fails the whole plugin where TS keeps it active after a command or render error, which was
already the behavior for external plugins (O-42). A panic in Rust usually means the plugin's state is broken, while
a JS exception usually does not.
