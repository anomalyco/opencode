// T08: without `debug.devtools`, the DevTools bar shows on the `local` channel only. The TS CLI run from source has
// no embedded channel, so it is `local` and draws the bar; Rust reads its channel at run time, `latest` without
// `OPENCODE_CHANNEL`, and draws none (parity/deviations/T08-devtools-channel.md). `channel-local.pty.ts` gives Rust
// the `local` channel, and both draw the same bar.
import { definePty } from "../../pty/run"

export const home = {
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" as const },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 800, timeout: 30_000, checkpoint: "home" },
    // Ctrl+C on the empty prompt exits; a second press could land once the terminal is restored, as a SIGINT.
    { keys: "\x03", until: { exit: true } },
  ],
  exits: true,
  masks: [
    { pattern: /Ask anything… .*$/, reason: "the placeholder is picked at random" },
    {
      pattern: /[○⦿●](?= UI )/,
      reason: "the UI tab shows the client's own frame delay sample, which follows the machine's load",
    },
  ],
}

export default definePty({
  ...home,
  env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ experimental: { "new-designs": true } }) },
  steps: home.steps.map((step) =>
    step.checkpoint ? { ...step, deviation: { file: "T08-devtools-channel", lines: 3 } } : step,
  ),
})
