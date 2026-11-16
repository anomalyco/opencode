// The leader sequence expires `leader.timeout` (2,000 ms by default) after the leader key (`keymap.tsx:137-146`).
// One second after Ctrl+X, `l` still completes `session.list` (<leader>l); past the timeout, `l` is typed into the
// prompt. `settle` waits at least that long, so the first wait stays under the timeout and the second goes past it.
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
    { keys: "\x18", settle: 1000 },
    { keys: "l", until: { screen: "Search sessions" }, settle: 300, checkpoint: "completed" },
    { keys: "\x1b", settle: 300 },
    { keys: "\x18", settle: 2600 },
    { keys: "l", settle: 300, absent: "Search sessions", checkpoint: "expired" },
  ],
  osc: [],
  masks: [
    { pattern: /Ask anything… .*$/, reason: "the placeholder example: random in TS and Rust" },
    {
      pattern: /(<root>|\/)\S*(\s+shift\+tab agents.*)?$/,
      reason:
        "the prompt footer: the location (the server's default in TS, the launch directory in Rust) and E.14's hints",
    },
  ],
})
