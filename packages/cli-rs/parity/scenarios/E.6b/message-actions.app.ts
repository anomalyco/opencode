// Message Actions from the timeline (#65903): the search box sits in the title row, and typing filters the actions;
// escape closes the dialog.
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  args: { sessionID: "ses_m" },
  routes: [
    { path: "/api/session/ses_m", json: { data: session("ses_m", "Fix the parser", { updated: 3 }) } },
    {
      path: "/api/session/ses_m/message",
      json: {
        data: [
          assistant("msg_2", "The parser drops the last token.", 2),
          user("msg_1", "Why does the parser fail?", 1),
        ],
        cursor: {},
      },
    },
    { path: "/api/session/ses_m/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "session", until: "drops the last token" },
    { keys: ["ctrl+x", "g"] },
    { checkpoint: "timeline", until: "Search timeline" },
    { keys: ["enter"] },
    { checkpoint: "actions", until: "Search actions" },
    { type: "fork" },
    // The typed query in the title row; the cells show that only Fork stays listed.
    { checkpoint: "filtered", until: "fork" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "drops the last token" },
  ],
})
