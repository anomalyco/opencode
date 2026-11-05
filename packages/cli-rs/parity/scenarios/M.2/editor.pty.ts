// `/editor` and `prompt.editor` (Ctrl+X E) compose in `$EDITOR`; what it saves replaces the draft. `/editor`
// hands the editor the text after the command.
import { chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { definePty } from "../../pty/run"
import { config, leave, server, statusMask } from "./fixture"

// Wraps the draft it is given, so the scenario sees both the handoff and the result.
const editor = path.join(tmpdir(), "opencode-parity-m2-editor.sh")

export default definePty({
  args: ["mini", "-s", "ses_mini", "--no-replay"],
  cols: 60,
  rows: 20,
  env: { EDITOR: editor, VISUAL: "" },
  server: server(),
  setup: async (root) => {
    await config(root)
    await Bun.write(editor, `#!/bin/sh\nprintf 'edited <%s>' "$(cat "$1")" > "$1"\n`)
    await chmod(editor, 0o755)
  },
  steps: [
    { until: { screen: "┃" }, settle: 600, timeout: 30_000 },
    { keys: "/edit", settle: 300 },
    { keys: "\r", settle: 800, checkpoint: "slash" },
    { keys: "\x03", settle: 300 },
    { keys: "draft", settle: 200 },
    { keys: "\x18e", settle: 800, checkpoint: "keys" },
    { keys: "\x03", settle: 300 },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
