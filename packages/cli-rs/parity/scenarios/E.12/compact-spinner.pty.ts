// A busy tab's spinner in the compact rail steps on its own (W04, `TabIndicator` in `session-tabs.tsx:190-198`):
// `-s ses_a` opens a session, a select opens `ses_b` beside it, a drag of the rail's handle (SGR reports, 1-based
// cells) makes the rail compact, and `ses_a` starts working in the background. With no input and no more events, the
// screen shows every spinner frame in turn. Rust stalled here: nothing else asked for a frame, so the spinner
// stepped only on input. Only the steps are compared: the rail's cells are P-APP's (`E.12/rail-resize`), and the
// window titles of a tab switch are H.3's.
import { definePty } from "../../pty/run"

const config = JSON.stringify({
  experimental: { "new-designs": true },
  debug: { devtools: false },
  tabs: { layout: "vertical" },
})
const here = { directory: "/tmp/opencode/packages/tui" }

const session = (id: string, title: string) => ({
  id,
  title,
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: here,
})
const reply = (text: string) => ({
  data: [
    { id: "msg_1", type: "user", text: "Why?", time: { created: 1 } },
    {
      id: "msg_2",
      type: "assistant",
      agent: "build",
      model: { providerID: "provider", id: "model" },
      content: [{ type: "text", text }],
      finish: "stop",
      time: { created: 2, completed: 3 },
    },
  ],
  cursor: {},
})
const routes = (id: string, title: string, text: string) => [
  { path: `/api/session/${id}`, json: { data: session(id, title) } },
  { path: `/api/session/${id}/message`, json: reply(text) },
  { path: `/api/session/${id}/inbox`, json: { data: [] } },
]
// From the handle (column 41) to column 8, one move per cell.
const drag = [
  "\x1b[<0;42;11M",
  ...Array.from({ length: 33 }, (_, step) => `\x1b[<32;${41 - step};11M`),
  "\x1b[<0;9;11m",
].join("")

export default definePty({
  args: ["-s", "ses_a"],
  cols: 120,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: {
    fallback: "tui",
    routes: [
      ...routes("ses_a", "Fix the parser", "The parser drops the last token."),
      ...routes("ses_b", "Write the docs", "The docs are written."),
      { method: "POST", path: "/api/session/:sessionID/view", json: {} },
    ],
  },
  steps: [
    { until: { screen: "The parser drops the last token." }, settle: 500, timeout: 30_000 },
    {
      emit: [{ id: "evt_1", created: 3, type: "tui.session.select", location: here, data: { sessionID: "ses_b" } }],
      until: { screen: "The docs are written." },
      settle: 300,
    },
    { keys: drag, until: { screen: "⌕" }, settle: 300 },
    {
      emit: [
        {
          id: "evt_2",
          created: 4,
          type: "session.execution.started",
          durable: { aggregateID: "ses_a", seq: 1, version: 1 },
          data: { sessionID: "ses_a" },
        } as never,
      ],
      until: { screen: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/ },
    },
    // A full turn of the spinner, 80 ms a frame. A frame missed between two reads of the screen comes round again
    // within the timeout.
    ...["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"].map((frame) => ({
      until: { screen: frame },
      timeout: 2_000,
    })),
  ],
  osc: [],
})
