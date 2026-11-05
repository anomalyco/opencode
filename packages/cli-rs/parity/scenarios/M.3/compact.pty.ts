// The permission and form footers in a short, narrow, monochrome terminal: the compact layouts, without padding
// and scrollbars, and ASCII glyphs.
import { definePty } from "../../pty/run"
import { config, deployForm, leave, opened, server, shellPermission } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 50,
  rows: 14,
  server: server({ permissions: [shellPermission], forms: [deployForm] }),
  setup: (root) => config(root, { mono: true }),
  steps: [
    { ...opened, until: { screen: "Permission" }, checkpoint: "permission" },
    { keys: "\x1b", settle: 300, checkpoint: "reject" },
    { keys: "\x1b", settle: 300 },
    { keys: "\x1b[D", settle: 200 },
    { keys: "\x1b[D", settle: 200 },
    { keys: "\r", until: { screen: "Deploy the build" }, settle: 400, checkpoint: "form" },
    { keys: "2", settle: 300, checkpoint: "picked" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
