// A failed execution of the open session shows the notifications plugin's error toast (F09): "Session failed" and
// the error message, without an action, since the session is already open.
import { defineApp, session } from "../../lib/app"

const execution = (kind: string, seq: number, data: Record<string, unknown> = {}) => ({
  id: `evt_${kind}_${seq}`,
  created: seq,
  type: `session.execution.${kind}`,
  durable: { aggregateID: "ses_b", seq, version: 1 },
  data: { sessionID: "ses_b", ...data },
})

const footer = {
  x: 60,
  y: 28,
  width: 40,
  height: 1,
  reason: "the prompt footer hints are E.14's (P01-read-only-prompt)",
}

export default defineApp({
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_b" },
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser") } },
    { path: "/api/session/ses_b/message", json: { data: [], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "open", until: "Fix the parser", masks: [footer] },
    { event: execution("started", 1) },
    { event: execution("failed", 2, { error: { type: "unknown", message: "The provider returned an error." } }) },
    { checkpoint: "failed", until: "Session failed", masks: [footer] },
  ],
})
