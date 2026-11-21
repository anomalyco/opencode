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
    { ...opened, until: { screen: "Permission required" }, checkpoint: "diff" },
    { keys: "\x03", settle: 200 },
    ...leave,
  ],
  exits: true,
})
