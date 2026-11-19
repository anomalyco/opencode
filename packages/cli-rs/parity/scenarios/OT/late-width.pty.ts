// A width-method change after startup (record 692). The terminal's DECRPM 2027 reply arrives once the home screen and
// its prompt exist. It says the terminal does not cluster graphemes (mode 0), so text is measured by code point from
// then on (wcwidth). `👍🏽` (a thumb and a skin tone) is then 4 cells, not 2. The prompt's textarea was created before
// the reply; the cursor after the typed `👍🏽` shows that it measures with the new method (OpenTUI #2148, on both
// sides since 0.9.4).
import { definePty } from "../../pty/run"

const config = JSON.stringify({ experimental: { "new-designs": true }, debug: { devtools: false } })

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: { fallback: "tui" },
  cursor: true,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    // The late reply, as the terminal would send it, after setup's wait has ended.
    { keys: "\x1b[?2027;0$y", settle: 500 },
    { keys: "👍🏽", settle: 500, checkpoint: "typed" },
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
