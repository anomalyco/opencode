// A prompt waits in the inbox when mini attaches. Once the server delivers it, the transcript prints it above the
// answer, as a prompt this client sent.
import type { Logged } from "../../lib/fake-server"
import { definePty } from "../../pty/run"
import { answer } from "../M.2/fixture"
import { config, leave, opened, server } from "./fixture"

const item = {
  id: "msg_prequeued",
  sessionID: "ses_mini",
  time: { created: 40 },
  type: "user",
  payload: { text: "queued before attach" },
  delivery: "queue",
}
const lists = (requests: Logged[]) => requests.filter((entry) => entry.path === "/api/session/ses_mini/inbox")
const base = server()

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: {
    ...base,
    routes: [
      {
        path: "/api/session/ses_mini/inbox",
        json: { data: [item] },
        thenDelay: 1500,
        then: (_entry: Logged, requests: Logged[]) =>
          lists(requests).length === 1 ? answer(item.id, "Answered prequeued.") : [],
      },
      ...(base.routes ?? []),
    ],
  },
  setup: (root) => config(root),
  steps: [opened, { until: { screen: "Answered prequeued." }, settle: 800, checkpoint: "delivered" }, ...leave],
  exits: true,
  masks: [
    {
      pattern: /^(ctrl\+x q \d+ pending · )?build · model · demo( · ctrl\+p menu)?$/,
      reason: "the ctrl+p menu and pending-prompt hints open M.3's views",
    },
  ],
  requests: "writes",
})
