// `/editor` and `prompt.editor` (Ctrl+X E) compose in `$EDITOR`; what it saves replaces the draft. `/editor`
// hands the editor the text after the command.
import { chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { definePty } from "../../pty/run"
import { config, leave, server, statusMask } from "./fixture"

// Wraps the draft it is given, so the scenario sees both the handoff and the result. One per runner process, so
// runs from other worktrees do not rewrite it while it runs.
const editor = path.join(tmpdir(), `opencode-parity-m2-editor-${process.pid}.sh`)

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
  // The terminal is in cooked mode while the editor runs, where a Ctrl+C is SIGINT: each handoff waits for the
  // edited draft, which shows only after the client took the terminal back.
  steps: [
    { until: { screen: "┃" }, settle: 600, timeout: 30_000 },
    { keys: "/edit", settle: 300 },
    { keys: "\r", until: { screen: "edited </edit>" }, settle: 800, checkpoint: "slash" },
    { keys: "\x03", settle: 300 },
    { keys: "draft", settle: 200 },
    { keys: "\x18e", until: { screen: "edited <draft>" }, settle: 800, checkpoint: "keys" },
    { keys: "\x03", settle: 300 },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
