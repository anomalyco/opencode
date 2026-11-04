// External editor (P09): `prompt.editor` (<leader>e) writes the prompt to a temporary file, hands the terminal to
// $EDITOR, and reads the file back into the prompt. $EDITOR is fake-editor.sh beside this file, which rewrites the
// file and records whether it had the terminal; no real editor runs. The temporary file goes to the sandbox's
// TMPDIR.
import path from "node:path"
import { definePty } from "../../pty/run"

const config = JSON.stringify({ experimental: { "new-designs": true }, debug: { devtools: false } })

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  env: {
    OPENCODE_CLI_CONFIG_CONTENT: config,
    EDITOR: path.join(import.meta.dir, "fake-editor.sh"),
  },
  server: { fallback: "tui" },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "hello", until: { screen: "hello" }, settle: 200 },
    { keys: "\x18e", until: { screen: "second line" }, settle: 300, timeout: 10_000, checkpoint: "edited" },
    // Ctrl+C clears the prompt, then exits.
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
  ],
  osc: [],
  masks: [
    {
      pattern: /(<root>|\/)\S*(\s+shift\+tab agents.*)?$/,
      reason:
        "the prompt footer: the location (the server's default in TS, the launch directory in Rust) and E.14's hints",
    },
  ],
  exits: true,
})
