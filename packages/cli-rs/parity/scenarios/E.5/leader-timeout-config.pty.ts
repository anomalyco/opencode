// A configured `leader.timeout` of 1,000 ms (`keymap.tsx:143`): 200 ms after Ctrl+X, `l` still completes
// `session.list` (<leader>l); 1,600 ms after it, under the 2,000 ms default, `l` is typed into the prompt.
import { definePty } from "../../pty/run"

const config = JSON.stringify({
  experimental: { "new-designs": true },
  debug: { devtools: false },
  leader: { timeout: 1000 },
})

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: { fallback: "tui" },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "\x18", settle: 200 },
    { keys: "l", until: { screen: "Search sessions" }, settle: 300, checkpoint: "completed" },
    { keys: "\x1b", settle: 300 },
    { keys: "\x18", settle: 1600 },
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
