// `tools.app.ts` at the default transcript verbosity (low, #63207): the finished tool calls fold into one
// summary row, even with `session.grouping: none`.
import base from "./tools.app"

export default {
  ...base,
  config: { session: { grouping: "none" } },
  steps: [{ checkpoint: "open", until: "1 command, 1 edit, 1 read" }],
}
