// Attention (N01, N03, N04, F09): `-s ses_b` opens a session with `attention.notifications` on. The steps report a
// focus loss, then the session works, asks for a permission, gets the reply and is done; then focus returns and the
// session fails. Compared: the OSC 7501 program status records (`context/program-status.ts`) and the notifications
// (`attention.ts`), which go out only while the terminal is blurred. Quitting clears the root record.
import { definePty } from "../../pty/run"

const config = JSON.stringify({
  experimental: { "new-designs": true },
  debug: { devtools: false },
  animations: false,
  attention: { notifications: true },
})

const session = {
  id: "ses_b",
  title: "Fix the parser",
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: "/tmp/opencode/packages/tui" },
}

const durable = (seq: number) => ({ aggregateID: "ses_b", seq, version: 1 })
const execution = (kind: string, seq: number, data: Record<string, unknown> = {}) =>
  ({
    id: `evt_${kind}_${seq}`,
    created: seq,
    type: `session.execution.${kind}`,
    durable: durable(seq),
    data: { sessionID: "ses_b", ...data },
  }) as never

export default definePty({
  args: ["-s", "ses_b"],
  cols: 100,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
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
    // Focus out.
    { keys: "\x1b[O", settle: 200 },
    { emit: [execution("started", 1)], until: { osc: "state=working" }, settle: 300 },
    {
      emit: [
        {
          id: "evt_asked",
          created: 2,
          type: "permission.asked",
          data: { id: "per_1", sessionID: "ses_b", action: "edit", resources: [], metadata: {}, save: [] },
        } as never,
      ],
      until: { osc: "state=blocked" },
      settle: 300,
    },
    {
      emit: [
        {
          id: "evt_replied",
          created: 3,
          type: "permission.replied",
          data: { sessionID: "ses_b", requestID: "per_1", reply: "once" },
        } as never,
      ],
      settle: 300,
    },
    { emit: [execution("succeeded", 4)], until: { osc: "state=idle" }, settle: 300 },
    // Focus in: the failure toasts but does not notify.
    { keys: "\x1b[I", settle: 200 },
    {
      emit: [execution("started", 5), execution("failed", 6, { error: { type: "unknown", message: "boom" } })],
      until: { screen: "Session failed" },
      settle: 300,
    },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
  ],
  osc: ["status", "notify"],
  // Deviation N03-status-order: the order between a notification and a status record is not fixed in Rust.
  oscByKind: true,
  exits: true,
})
