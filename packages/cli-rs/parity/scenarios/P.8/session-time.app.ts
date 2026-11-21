// Contract 2.x, addition 4: `opencode-session-time@0.4.0`, unmodified from npm. Its `/time` opens a select of the
// session's assistant turns, newest first, then `dialog.set({ size: "xlarge", centered: true })`; picking a turn opens
// an alert of its details, set the same way. Both dialogs are extra large and centered, as in TS. TS loads the package
// from node_modules; the Rust client runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_t"
// Three turns, on 1 January 1970: the plugin writes a time of another day with its date, so it reads the same any day.
const turn = (n: number, text: string) => [
  user(`msg_u${n}`, `Question ${n}`, n * 60_000),
  {
    ...assistant(`msg_a${n}`, text, n * 60_000 + 1_000),
    time: { created: n * 60_000 + 1_000, completed: n * 60_000 + 4_500 },
  },
]
const messages = [...turn(1, "First answer."), ...turn(2, "Second answer."), ...turn(3, "Third answer.")].reverse()
// The plugin's live timings, its sidebar block and its footer clock, recompute on its one-second timer in TS, whose
// recorder's clock does not advance, so they read none of the turns; the layer's reads of the session's messages are
// watched, so in Rust they read them as soon as they come. The dialogs are what this scenario compares.
const live = "the plugin's live timings: TS recomputes them on a timer its recorder never fires"
const masks = [
  { x: 100, y: 4, width: 38, height: 7, reason: live },
  { x: 50, y: 32, width: 13, height: 1, reason: live },
]

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-session-time"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Time the turns", { updated: 200_000 }) } },
    { path: "/api/session", json: { data: [session(id, "Time the turns", { updated: 200_000 })], cursor: {} } },
    { path: `/api/session/${id}/message`, json: { data: messages, cursor: {} } },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    { checkpoint: "session", until: "Third answer.", masks },
    { type: "/time" },
    { checkpoint: "slash", until: "Time: session timeline", masks },
    { keys: ["enter"] },
    // The select draws the plugin's `Close ctrl+a` action under its rows, as TS's (contract gaps 2).
    { checkpoint: "timeline", until: "3 turns", masks },
    { keys: ["enter"] },
    { checkpoint: "details", until: "Turn details", masks },
  ],
})
