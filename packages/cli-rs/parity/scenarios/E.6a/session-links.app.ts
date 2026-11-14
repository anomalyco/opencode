// Session IDs in a reply link to their sessions (#63224, #63247): a loaded session shows as `@<title>`, the current,
// an archived and an unknown session stay IDs, and so does a code span that is more than the ID. A rename draws the
// new title, and a click on the link opens that session.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = (name: string) => `ses_${name.padEnd(26, "0")}`
const current = id("current")
const known = id("known")
const archived = id("archived")
const unknown = id("unknown")

export default defineApp({
  args: { sessionID: current },
  routes: [
    { path: `/api/session/${current}`, json: { data: session(current, "Fix the parser", { updated: 2 }) } },
    {
      path: `/api/session/${current}/message`,
      json: {
        data: [
          assistant(
            "msg_2",
            [
              `This continues ${known}, not ${current}.`,
              "",
              `- archived ${archived}`,
              `- unknown @session:${unknown}`,
              "",
              `Run \`opencode --session ${known}\` or open \`${known}\`.`,
            ].join("\n"),
          ),
          user("msg_1", "Which sessions touched the parser?"),
        ],
        cursor: {},
      },
    },
    { path: `/api/session/${current}/inbox`, json: { data: [] } },
    { path: `/api/session/${known}`, json: { data: session(known, "Fix the flaky reconnect test", { updated: 1 }) } },
    { path: `/api/session/${known}/message`, json: { data: [user("msg_k", "Why is reconnect flaky?")], cursor: {} } },
    { path: `/api/session/${known}/inbox`, json: { data: [] } },
    {
      path: `/api/session/${archived}`,
      json: { data: { ...session(archived, "Old work"), time: { created: 1, updated: 1, archived: 1 } } },
    },
    {
      path: `/api/session/${unknown}`,
      status: 404,
      json: { _tag: "SessionNotFoundError", sessionID: unknown, message: `Session not found: ${unknown}` },
    },
  ],
  steps: [
    { checkpoint: "labels", until: "@Fix the flaky reconnect test" },
    {
      event: {
        id: "evt_1",
        created: 3,
        type: "session.renamed",
        durable: { aggregateID: known, seq: 1, version: 1 },
        data: { sessionID: known, title: "Reconnect retries" },
      },
    },
    { checkpoint: "renamed", until: "@Reconnect retries" },
    { click: [24, 6] },
    { checkpoint: "opened", until: "Why is reconnect flaky?" },
  ],
})
