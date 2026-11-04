// The TUI on home against an empty server sets the title to "OpenCode" (`packages/tui/src/app.tsx:644`)
// and resets it when it exits. The server answers the TUI's startup reads with the TUI test defaults.
// Rust gets the TUI in T.1 and the title in E.1.
import { definePty } from "../../pty/run"

export default definePty({
  args: [],
  tsOnly: true,
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  steps: [
    // The title can come before the first paint, so wait for the prompt as well.
    { until: { osc: "OpenCode", screen: "Ask anything" }, settle: 500, checkpoint: "home", timeout: 30_000 },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
  ],
  masks: [{ pattern: /(?<=Ask anything… )".*"/, reason: "the home placeholder is picked at random" }],
  exits: true,
})
