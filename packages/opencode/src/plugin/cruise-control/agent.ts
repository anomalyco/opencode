import { PermissionModule } from "@opencode-ai/schema/permission-module"
import { managedAppDirectoryGlobs } from "./classifier"
import PROMPT from "./prompt.txt"

/** Builtin agent id `cruisecontrol` (display: CruiseControl). Distinct from classifier id `cruise_control`. */
export const AGENT_ID = "cruisecontrol" as const

export const AGENT_DESCRIPTION =
  "Autonomous execution agent. Careful tool use; tool permissions go through the cruise_control classifier."

export const AGENT_PROMPT = PROMPT

/** V1 permission config for the CruiseControl agent (host still seeds the agent; V1 plugins cannot register agents). */
export function cruiseControlPermissionConfig() {
  return {
    "*": PermissionModule.CRUISE_CONTROL,
    question: "allow" as const,
    plan_enter: "allow" as const,
    // After "*": cruise_control so findLast prefers these over the module.
    external_directory: Object.fromEntries(managedAppDirectoryGlobs().map((dir) => [dir, "allow" as const])),
  }
}
