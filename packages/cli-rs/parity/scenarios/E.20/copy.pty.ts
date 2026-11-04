// Copy-on-select (T13, CB01): a mouse drag over text typed into the home prompt copies it, and the terminal
// receives the text as OSC 52 (`clipboard.ts:53-61`). The sandbox has no display, so the host clipboard is
// unavailable on both sides and OSC 52 is the only destination; the real clipboard is never written. The mouse
// keys are SGR reports (1-based cells): press, drag, and release on row 17, columns 17 to 25, "copy this".
//
// Other targets meet differences outside E.20 (see the E.20 report): the prompt footer's location (the Rust
// home shows the launch directory, TS the server's default location), a dialog (a drag closes a Rust dialog),
// and a toast (a release runs a Rust toast's action).
import { definePty } from "../../pty/run"

const config = JSON.stringify({ experimental: { "new-designs": true }, debug: { devtools: false } })

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: { fallback: "tui" },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "copy this text", until: { screen: "copy this text" }, settle: 200 },
    { keys: "\x1b[<0;17;17M", settle: 50 },
    { keys: "\x1b[<32;21;17M\x1b[<32;25;17M", settle: 50 },
    { keys: "\x1b[<0;25;17m" },
    { until: { osc: "52;" }, settle: 300, timeout: 10_000, checkpoint: "copied" },
    // Escape clears the selection; Ctrl+U empties the prompt so Ctrl+C exits.
    { keys: "\x1b", settle: 300 },
    { keys: "\x15", settle: 300 },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
  ],
  osc: ["clipboard"],
  masks: [
    {
      pattern: /(<root>|\/)\S*(\s+shift\+tab agents.*)?$/,
      reason:
        "the prompt footer: the location (the server's default in TS, the launch directory in Rust) and E.14's hints",
    },
  ],
  exits: true,
})
