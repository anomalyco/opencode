# G16: shutdown deadline

TypeScript: SIGTERM or SIGINT interrupts the main fiber, so every finalizer runs. The exit code is 130. The
deadline reports the `Teardown.pending()` items of the LayerNode layers.

Rust: a signal runs only the steps that commands register with `signals::on_shutdown`, newest first, then exits
with 130. The handler's own drops do not run. The report lists those steps. If no step is registered, the line is
"nothing tracked; the stuck work is not a registered teardown step". The deadline, the second-signal exit, and the
SIGHUP rule (only with a terminal on stdin or stdout) match TS. While the TUI runs, opentui handles the three
signals and quits the app, so the TUI exits through its normal path with code 0.

Reason: Rust commands block their thread and have no interruptible fiber. A standalone server needs no step: its
stdin lease ends when the client exits.
