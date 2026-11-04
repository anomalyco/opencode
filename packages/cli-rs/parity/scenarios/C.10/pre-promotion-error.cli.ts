// The execution fails before the prompt is promoted: that error is reported instead.
import { defineCli } from "../../cli/run"
import { event, nowMask, server } from "./fixture"

export default defineCli({
  args: ["run", "--format", "json", "hello"],
  server: server({
    delivered: false,
    listed: false,
    end: event("session.execution.failed", { error: { type: "unknown", message: "no provider" } }, 7),
  }),
  masks: [nowMask],
})
