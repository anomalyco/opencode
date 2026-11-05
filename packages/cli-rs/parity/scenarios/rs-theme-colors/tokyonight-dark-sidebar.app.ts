import base from "../E.14/sidebar.app"
import { themed } from "./themed"

// The reply can land after the sidebar card, so the first checkpoint waits for the reply.
const scenario = themed(base, "tokyonight", "dark")
export default {
  ...scenario,
  steps: scenario.steps.map((step) =>
    "checkpoint" in step && step.checkpoint === "docked" ? { ...step, until: "The release plan is ready." } : step,
  ),
}
