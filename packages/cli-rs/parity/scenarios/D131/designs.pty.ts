// D131: with the config a release starts with, where TS draws its old designs. The palette has a "Commands" title
// above a "Search" field where Rust searches in the title row ("Search commands"), and `/debug` copies with Enter
// where Rust's footer names `c`. Both are the new designs, the only ones Rust draws (X02).
import { definePty } from "../../pty/run"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ debug: { devtools: false } }) },
  server: { fallback: "tui" },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    {
      keys: "\x10",
      until: { screen: "esc" },
      settle: 300,
      checkpoint: "palette",
      deviation: { file: "X02-new-designs-graduated", lines: 12 },
    },
    // Each Escape waits for its dialog to close: a lone ESC not yet read would join the next key.
    { keys: "\x1b", until: { gone: "Suggested" }, settle: 300 },
    { keys: "/debug", until: { screen: "/debug" }, settle: 300 },
    {
      keys: "\r",
      until: { screen: "Share this when reporting an issue" },
      settle: 300,
      checkpoint: "debug",
      deviation: { file: "X02-new-designs-graduated", lines: 12 },
    },
    { keys: "\x1b", until: { gone: "Share this when reporting an issue" }, settle: 300 },
    // Ctrl+C on the empty prompt exits; a second press could land once the terminal is restored, as a SIGINT.
    { keys: "\x03", until: { exit: true } },
  ],
  masks: [
    { pattern: /Date\s+\S+/, reason: "the time the dialog opened" },
    { pattern: /Version\s+.*$/, reason: "each CLI's version and channel" },
    { pattern: /Terminal\s+.*$/, reason: "the terminal each side detects" },
  ],
  exits: true,
})
