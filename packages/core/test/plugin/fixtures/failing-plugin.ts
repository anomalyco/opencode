import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export default define({
  id: "failing-plugin",
  effect: () => Effect.die("plugin failed"),
})
