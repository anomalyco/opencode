# F16: plugin calls are timed

## TypeScript

The TUI times no plugin callback. A slow callback makes the UI slow and nobody is told; a callback that never
returns freezes the TUI for good.

## Rust

Every plugin call, of a built-in and of an external plugin, is timed.

- A plugin over 1 ms in more than 12 of the last 120 frames it ran in is slow. One warning toast a session says
  `Plugin is slow: <id>`, with what a slow frame costs and a Disable action, and its row in `/plugins` shows p50, p99
  and worst per call kind. This applies to built-ins too.
- One call over 100 ms fails an external plugin, after the call's effects applied: the toast `Plugin failed: <id>`,
  and `/plugins` lists `<call> took <n> ms, over the limit of 100 ms`. A Luau call is stopped by its VM's interrupt at
  that limit. For a built-in it is logged as a host bug. `OPENCODE_PLUGIN_LIMITS` changes the limits.

There is no crash guard: a plugin that crashes the process (only the Luau VM could) ends the client, and
`opencode-native --no-plugins` starts it with no external plugin ([`D01-no-plugins.md`](D01-no-plugins.md)).

## Reason

The client runs plugin UI code in the client's process and on its UI thread, so the budget is what tells the user which
plugin makes the UI slow. TS plugins run in the JS host's process, Luau calls stop on Luau's own CPU interrupt, and
the built-ins are first-party, so nothing in process needs a watchdog or a restarting parent. The slow state
applies to built-ins because the budget cannot tell them apart on the frame; it only informs.
