# OT2056: the text-sizing probe stays off the main screen

TypeScript: `@opentui/core` 0.8.4 probes for kitty's text-sizing protocol (OSC 66) during startup, before setup enters the
alternate screen. It moves the cursor home and writes `ESC ] 66 ; w=1 ; ␠` and `ESC ] 66 ; s=2 ; ␠`, each followed by
a cursor position request, then restores the cursor. A terminal that draws OSC 66 (kitty) paints those spaces over
the start of the main screen's top two rows. Mini runs on the main screen, so the damage stays in its history. The TUI
damages the main screen just before switching away, so the damage shows again after it exits.

Rust: the client pins OpenTUI `dbd6949f2` (anomalyco/opentui#2056). Mini writes no probe, and kitty 0.40+ and foot
1.21+ are recognised from the XTVERSION reply that startup already asks for. The TUI probes right after it enters the
alternate screen, on row 2 under its own cursor save, and the first frame repaints those cells. Explicit width comes
from the two probe replies together.

Driven with a P-PTY emulator that draws OSC 66 as kitty does and names itself `kitty(0.40.1)` (`terminal: "kitty"`),
under three rows of earlier shell output:

- `parity/scenarios/OT/text-sizing-mini.pty.ts`: TS shows `  ls` and `  pha  beta  gamma`, and Rust `$ ls` and
  `alpha  beta  gamma`, while mini runs and after it exits. The footer and the rest of the screen are the same.
- `parity/scenarios/OT/text-sizing-tui.pty.ts`: the TUI home is the same on both sides. After exit, the same two rows
  differ.

Both scenarios are equal when run TS against TS. In the harness's default emulator (libghostty, which ignores OSC 66)
the startup bytes differ, but every screen is the same: TS writes the probe at home, mini writes none, and the TUI
writes it on alternate-screen row 2. All P-PTY `M.*` and `E.*` scenarios pass.

Reason: the fix stops OpenCode's mini mode from damaging the user's history in kitty. The difference goes away when TS
moves to an `@opentui/core` release that includes #2056.
