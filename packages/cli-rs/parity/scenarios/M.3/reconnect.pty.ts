// A permission waits when mini opens the session. The event stream drops while another client answers it, so
// no `permission.replied` arrives: the reconnect lists the requests again and the composer comes back.
import { DROP, type Logged } from "../../lib/fake-server"
import { definePty } from "../../pty/run"
import { config, leave, opened, server, shellPermission } from "./fixture"

const lists = (requests: Logged[]) => requests.filter((entry) => entry.path === "/api/session/ses_mini/permission")
const base = server()

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 24,
  server: {
    ...base,
    routes: [
      {
        path: "/api/session/ses_mini/permission",
        json: (_entry: Logged, requests: Logged[]) => ({ data: lists(requests).length === 1 ? [shellPermission] : [] }),
        thenDelay: 1500,
        then: (_entry: Logged, requests: Logged[]) => (lists(requests).length === 1 ? [DROP] : []),
      },
      ...(base.routes ?? []),
    ],
  },
  setup: (root) => config(root),
  steps: [
    { ...opened, until: { screen: "Permission required" }, checkpoint: "asked" },
    { until: { screen: "ctrl+p menu" }, settle: 800, checkpoint: "reconnected" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
