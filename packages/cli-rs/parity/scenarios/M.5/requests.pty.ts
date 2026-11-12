// A running child waits on a permission and a form of no session waits at the session's location when mini opens.
// The child's permission shows first; Allow once answers it under the child's session. The global form follows;
// its answer goes to `session/global` with the location in a header, and the server's events take both away.
import { definePty } from "../../pty/run"
import { config, leave, server } from "./fixture"

const childPermission = {
  id: "per_child",
  sessionID: "ses_run",
  action: "webfetch",
  resources: ["https://example.com/tests"],
  metadata: { url: "https://example.com/tests" },
}

const globalForm = {
  id: "frm_global",
  sessionID: "global",
  title: "Connect the tracker",
  fields: [{ type: "boolean", key: "connect", title: "Connect now?", required: true }],
}

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 24,
  server: server({ childPermissions: [childPermission], globalForms: [globalForm] }),
  setup: (root) => config(root),
  steps: [
    // The footer can show the permission before the replayed transcript is written, so wait for the transcript's
    // last row and the footer's.
    {
      until: { screen: /› check the tests[\s\S]*Permission required[\s\S]*Allow once/ },
      settle: 800,
      timeout: 30_000,
      checkpoint: "permission",
    },
    { keys: "\r", until: { screen: "Connect the tracker" }, settle: 500, checkpoint: "form" },
    { keys: "1", until: { screen: "1 sub" }, settle: 600, checkpoint: "answered" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
