# OT2035: a copy writes the terminal clipboard after the system clipboard

TypeScript: the TUI copies with `@opentui/core` 0.8.4's `all-available` policy. It starts the system clipboard write
and sends OSC 52 to the terminal at once, while that write runs. On X11 and Wayland the last writer owns the
clipboard, so the app usually ends as the owner and the copy is gone after the user quits.

Rust: the client pins OpenTUI `95933781d`, which includes anomalyco/opentui#2035 and #2038. In a local session, a
copy writes the system clipboard first and sends OSC 52 when that write ends (with any result) or when the app
exits; of several copies in flight, the terminal gets only the newest. The terminal then owns the selection and
the copy outlives the app. Over SSH, OSC 52 is still sent at once. A system clipboard write on macOS or Windows that
does not finish gives up after 1 s (#2038). The P-PTY scenario `E.20/copy` (no system clipboard in the sandbox)
still sends the same OSC 52 as TS.

Reason: the OpenTUI fix landed after the npm release that TS uses (Core changed its own order in #2028). The
difference goes away when TS moves to an `@opentui/core` release that includes #2028.
