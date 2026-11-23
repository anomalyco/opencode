// D131: with the config a release starts with. Since #64988 TS draws the new designs there too, the only ones Rust
// draws (X02): the palette searches in its title row ("Search commands") and `/debug` copies with `c` in both.
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
    },
    // Each Escape waits for its dialog to close: a lone ESC not yet read would join the next key.
    { keys: "\x1b", until: { gone: "Suggested" }, settle: 300 },
    { keys: "/debug", until: { screen: "/debug" }, settle: 300 },
    {
      keys: "\r",
      until: { screen: "Share this when reporting an issue" },
      settle: 300,
      checkpoint: "debug",
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
