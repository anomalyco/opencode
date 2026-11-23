// `running-reply.app.ts` at the default transcript verbosity (low, #63207): the streaming reasoning and the
// running shell call fold into one status row.
import base from "./running-reply.app"

export default {
  ...base,
  config: { experimental: { "new-designs": true } },
  steps: base.steps.map((step) =>
    "checkpoint" in step && step.checkpoint !== "waiting" ? { ...step, until: "esc interrupt" } : step,
  ),
}
