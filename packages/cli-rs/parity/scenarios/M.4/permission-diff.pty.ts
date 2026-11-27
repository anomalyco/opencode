// An edit waits for permission with its diff: the footer draws it with line numbers and signs, as the scrollback
// draws an edit.
import { definePty } from "../../pty/run"
import { config, leave, opened, server } from "../M.3/fixture"
import { patch } from "./fixture"

const editPermission = {
  id: "per_edit",
  sessionID: "ses_mini",
  action: "edit",
  resources: ["src/main.ts"],
  metadata: { filePath: "/tmp/mini/src/main.ts", diff: patch },
}

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 24,
  server: server({ permissions: [editPermission] }),
  setup: (root) => config(root),
  steps: [
    // The permission draws in two frames: its heading first, then its diff and actions. Waiting for the heading
    // alone let a loaded client's 600 ms quiet window expire between them, and the checkpoint captured the
    // heading over the old transcript. Wait for the whole footer, diff and actions included.
    { ...opened, until: { screen: /1 - const a = 1[\s\S]*Allow once/ }, checkpoint: "diff" },
    { keys: "\x03", settle: 200 },
    ...leave,
  ],
  exits: true,
})
