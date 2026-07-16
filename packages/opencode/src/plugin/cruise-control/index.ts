import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { PermissionModule as PermissionModuleSchema } from "@opencode-ai/schema/permission-module"
import { Effect } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { decideCruiseControl, ensureDefaultSystemPrompt } from "./classifier"

export {
  applySafety,
  decideCruiseControl,
  DEFAULT_ALLOWLIST,
  DEFAULT_SYSTEM_PROMPT,
  destructiveReason,
  ensureDefaultSystemPrompt,
  hasConfiguredSystemPrompt,
  isManagedAppDirectoryPattern,
  managedAppDirectoryAllow,
  managedAppDirectoryGlobs,
  managedAppDirectoryRoots,
  MISSING_MODEL_MESSAGE,
  parseClassifierResult,
  resolveSystemPrompt,
  runClassifier,
  shortenReason,
  type ClassifierObject,
  type Decision,
  type DecideInput,
  type DecideResult,
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
 * On init, seeds `permission_modules.cruise_control.system_prompt` into global
 * config when unset/blank so users can edit the default in kancode.json.
 */
export function createCruiseControlPlugin(bridge: EffectBridge.Shape): Plugin {
  return async (input: PluginInput): Promise<Hooks> => {
    await bridge.promise(
      ensureDefaultSystemPrompt().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("cruise_control failed to seed default system_prompt", {
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
