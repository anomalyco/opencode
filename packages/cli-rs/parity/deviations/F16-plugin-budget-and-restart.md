# F16: plugin calls are timed, and a native plugin's crash restarts the client

## TypeScript

The TUI times no plugin callback. A slow callback makes the UI slow and nobody is told; a callback that never
returns freezes the TUI for good. TS has no native plugins, so no plugin can end the process with a segfault, and
there is nothing to restart.

## Rust

Every plugin call, of a built-in and of an external plugin, is timed (synthesis 4.4, phase P4c).

- A plugin over 1 ms in more than 12 of the last 120 frames it ran in is slow. One warning toast a session says
  `Plugin is slow: <id>`, with what a slow frame costs and a Disable action, and its row in `/plugins` shows p50, p99
  and worst per call kind. This applies to built-ins too.
- One call over 100 ms fails an external plugin, after the call's effects applied: the toast `Plugin failed: <id>`,
  and `/plugins` lists `<call> took <n> ms, over the limit of 100 ms`. For a built-in it is logged as a host bug.
  `OPENCODE_PLUGIN_LIMITS` changes the limits.

When a native build is among the plugin targets, the TUI runs under a parent process (synthesis 4.5). When a plugin
crashes or hangs the client, the parent restores the terminal and starts the client again on the same session, with
the draft, and one toast names the plugin and the call: `Plugin failed: <id>`, "It crashed the client in `<call>` and
is disabled", with Enable again. A hang first shows a line over the frozen screen at 0.5 s. The plugin stays
disabled, listed failed, until the user enables it or its build changes. A crash that names no plugin restarts the
client with a notice; a second one within 10 minutes restarts it with every external plugin off. The command line
is the same as TS's: the parent passes what the new client skips and resumes from in memory after a fork, or in the
environment (`OPENCODE_PLUGIN_SKIP`, `OPENCODE_PLUGIN_RESUME`) to a spawned client.

## Reason

O-123 runs native plugin code in the client's process and on its UI thread. A process boundary would have stopped a
hang and survived a segfault; in process, the budget, the watchdog and the restart are what stands in for it (O-125,
decision 5). TS has neither native plugins nor that risk. The slow state applies to built-ins because the budget
cannot tell them apart on the frame; it only informs.
