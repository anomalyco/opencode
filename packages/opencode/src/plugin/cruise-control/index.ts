import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { PermissionModule as PermissionModuleSchema } from "@opencode-ai/schema/permission-module"
import { Effect } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { decideCruiseControl, ensureDefaultInstructions } from "./classifier"

export {
  applySafety,
  CLASSIFIER_PREAMBLE,
  decideCruiseControl,
  DEFAULT_ALLOWLIST,
  DEFAULT_INSTRUCTIONS,
  destructiveReason,
  ensureDefaultInstructions,
  hasCompleteInstructions,
  isManagedAppDirectoryPattern,
  managedAppDirectoryAllow,
  managedAppDirectoryGlobs,
  managedAppDirectoryRoots,
  mergeInstructionsDefaults,
  MISSING_MODEL_MESSAGE,
  parseClassifierResult,
  renderSystemPrompt,
  resolveInstructions,
  resolveSystemPrompt,
  runClassifier,
  shortenReason,
  type ClassifierDecision,
  type ClassifierObject,
  type Decision,
  type DecideInput,
  type DecideResult,
  type Instructions,
} from "./classifier"

export {
  AGENT_DESCRIPTION,
  AGENT_ID,
  AGENT_PROMPT,
  cruiseControlPermissionConfig,
} from "./agent"

/**
 * Built-in Cruise Control plugin: registers permission module `cruise_control`
 * via the public `permission.registerModule` API.
 *
 * Disabled with other default plugins when `disableDefaultPlugins` is set.
 * Requires an EffectBridge so decide can use Config/Provider from the host fiber.
 *
 * On init, seeds `permission_modules.cruise_control.instructions` into global
 * config when sections are missing so users can edit defaults in kancode.json.
 */
export function createCruiseControlPlugin(bridge: EffectBridge.Shape): Plugin {
  return async (input: PluginInput): Promise<Hooks> => {
    await bridge.promise(
      ensureDefaultInstructions().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("cruise_control failed to seed default instructions", {
            error: String(cause),
          }),
        ),
      ),
    )

    input.permission.registerModule({
      id: PermissionModuleSchema.CRUISE_CONTROL,
      decide: async (req) => {
        const result = await bridge.promise(
          decideCruiseControl({
            moduleID: PermissionModuleSchema.CRUISE_CONTROL,
            permission: req.permission,
            patterns: req.patterns,
            metadata: req.metadata,
          }),
        )
        return { decision: result.decision, reason: result.reason }
      },
    })
    return {}
  }
}
