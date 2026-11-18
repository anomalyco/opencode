// D131: the command palette at first run. Its suggested commands and groups come in the order of TS's layers:
// `app.tsx`'s commands last in their order, the home prompt's before them, and the built-in plugins' first, as TS
// loads those once the first route has mounted. Up from the top shows the end of the list.
import { definePty } from "../../pty/run"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ experimental: { "new-designs": true }, debug: { devtools: false } }) },
  server: { fallback: "tui" },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "\x10", until: { screen: "Search commands" }, settle: 300, checkpoint: "palette" },
    { keys: "\x1b[A", settle: 300, checkpoint: "tail" },
    {
      keys: "update",
      until: { screen: "update" },
      settle: 300,
      checkpoint: "update",
      deviation: { file: "D131-update-command", lines: 2 },
    },
    // Each Escape waits for its dialog to close: a lone ESC not yet read would join the next key.
    { keys: "\x1b", until: { gone: "update" }, settle: 300 },
    // `/debug` copies with `c` under the new designs, as the footer says.
    { keys: "/debug", until: { screen: "/debug" }, settle: 300 },
    { keys: "\r", until: { screen: "copy c" }, settle: 300, checkpoint: "debug" },
    { keys: "\x1b", until: { gone: "copy c" }, settle: 300 },
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
