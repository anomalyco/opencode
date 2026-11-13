# F16: a plugin's program in the foreground is a job of its own

## TypeScript

A TUI plugin runs a program in the terminal with `api.renderer.suspend()`, then the program (for example with
`Bun.spawn` and `stdio: "inherit"`), then `api.renderer.resume()`. The program is a plain child: it shares the TUI's
process group, so Ctrl+C, Ctrl+\ and Ctrl+Z on the terminal signal the TUI as well. Its standard streams are
whatever the plugin passes. Input the program leaves unread reaches the TUI after `resume()`. Two plugins can
suspend at once.

## Rust

A plugin asks with `Host::foreground(program)` (ABI 1.6) and gets the exit in a reply. The host runs the program
once the plugin's call is done (`opencode_util::job`, `features::foreground`):

- Unix: in a process group of its own, made the terminal's foreground group while it runs. Ctrl+C and Ctrl+\ end
  the program and not the TUI. Ctrl+Z stops it, and the host continues it at once, as it holds the job and has no
  shell to hand a stopped one to. The reply has `"signal"` when a signal ended the program.
- Windows: the host ignores Ctrl+C and Ctrl+Break while the program runs, so the console's events end the program
  and not the TUI. (Reasoned from the code; not run on Windows.)
- Standard input and output are the TUI's, standard error is the terminal (`/dev/tty`, `CONOUT$`).
- Input the program leaves unread is dropped (`tcflush`, `FlushConsoleInputBuffer`).
- One program at a time, shared with `$EDITOR`: a second request is refused with an error reply.
- A program whose plugin was disabled or failed before it started does not start; a headless TUI (drive mode)
  refuses; without a `cwd`, a TUI directory that does not exist here runs the program in the host's own.
- The title is sent again after, since suspending the terminal cleared it.

Scenarios: `P.0b/foreground-signals`, `-streams`, `-title`, `-twice` (P-PTY, Rust only).

## Reason

A plugin must not be able to end or stop the client with an ordinary key in a program it ran (reviews bigboi-1,
bigboi-5, carbon-1). The Rust host owns the program, so it gives it job control a shell would.
