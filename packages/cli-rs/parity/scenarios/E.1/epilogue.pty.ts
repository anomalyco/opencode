// The exit epilogue (G14): `-s ses_b` opens the session, Ctrl+C quits, and the terminal shows the wordmark, the
// session title, and the command that continues it (`util/presentation.ts`). Both sides name themselves
// "opencode" (OPENCODE_CLI_NAME).
import { definePty } from "../../pty/run"

const session = {
  id: "ses_b",
  title: "Fix the parser",
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: "/tmp/opencode/packages/tui" },
}

export default definePty({
  args: ["-s", "ses_b"],
  cols: 100,
  rows: 30,
  server: {
    fallback: "tui",
    routes: [
      { path: "/api/session/ses_b", json: { data: session } },
      { path: "/api/session/ses_b/message", json: { data: [], cursor: {} } },
      { path: "/api/session/ses_b/inbox", json: { data: [] } },
    ],
  },
  steps: [
    { until: { screen: "Fix the parser" }, settle: 500, timeout: 30_000 },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
    { until: { screen: "opencode -s ses_b" }, settle: 300, checkpoint: "epilogue", timeout: 10_000 },
  ],
  osc: [],
  exits: true,
})
