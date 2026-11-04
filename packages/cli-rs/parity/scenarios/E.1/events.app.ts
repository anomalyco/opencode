// Server-driven events (T10, T11): `tui.toast.show` and `tui.command.execute` for the current location, one
// for another location that is ignored, `tui.session.select` opens a session, and `session.deleted` of the open
// session goes home with a toast.
import { assistant, defineApp, session, user } from "../../lib/app"

const here = { directory: "/tmp/opencode/packages/tui" }
const event = (id: string, type: string, data: unknown, location: unknown = here) => ({
  event: { id, created: 3, type, location, data },
})
// The home prompt's placeholder row (T17-home-prompt) and the prompt footer hints (P01-read-only-prompt).
const prompt = [
  { x: 16, y: 16, width: 84, height: 1, reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)" },
  { x: 50, y: 20, width: 50, height: 1, reason: "the prompt footer hints are E.14's (P01-read-only-prompt)" },
]

export default defineApp({
  // With tabs on, the tab strip (E.12) handles `session.deleted` first and goes home without the toast.
  config: { tabs: { mode: "off" } },
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_b/message",
      json: { data: [assistant("msg_2", "The parser drops the last token."), user("msg_1", "Why?")], cursor: {} },
    },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "home", until: "Ask anything", masks: prompt },
    event("evt_1", "tui.toast.show", { title: "Elsewhere", message: "Not for this location", variant: "error" }, {
      directory: "/somewhere/else",
    }),
    // No title: TS merges a replacing toast into the old one (T21-toast-replace-merge), and the deleted toast
    // below has none either.
    event("evt_2", "tui.toast.show", { message: "Deployed to staging", variant: "success" }),
    { checkpoint: "toast", until: "Deployed to staging", masks: prompt },
    event("evt_3", "tui.session.select", { sessionID: "ses_b" }),
    {
      checkpoint: "selected",
      until: "The parser drops the last token.",
      deviation: ["V01-plain-transcript", "P01-read-only-prompt"],
    },
    {
      event: {
        id: "evt_4",
        created: 4,
        type: "session.deleted",
        durable: { aggregateID: "ses_b", seq: 1, version: 1 },
        location: here,
        data: { sessionID: "ses_b" },
      },
    },
    { checkpoint: "deleted", until: "was deleted", masks: prompt },
    event("evt_5", "tui.command.execute", { command: "help.show" }),
    {
      checkpoint: "command",
      until: "Help",
      masks: [{ line: "Ask anything….*", reason: "the prompt placeholder is picked at random" }],
      deviation: ["T17-home-prompt", "P01-read-only-prompt"],
    },
  ],
})
