import type { Hooks, Plugin, PluginInput } from "@kancode/plugin"
import { PermissionModule as PermissionModuleSchema } from "@kancode/schema/permission-module"
import { Effect } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { clearDynamicLists, decideCruiseControl, ensureDefaultInstructions } from "./classifier"

/**
 * Built-in Cruise Control plugin: registers permission module `cruise_control`
 * via the public `permission.registerModule` API.
 *
 * Disabled with other default plugins when `disableDefaultPlugins` is set.
 * Requires an EffectBridge so decide can use Config/Provider from the host fiber.
 *
 * On init, seeds `permission_modules.cruise_control.instructions` into global
 * config when sections are missing so users can edit defaults in kancode.json.
 *
 * Clears the per-prompt dynamic allow/deny lists on each new user message
 * (`chat.message`) so learned decisions do not leak across prompt turns.
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
            userPrompt: req.userPrompt,
            sessionContext: req.sessionContext,
            approvalPrompt: req.approvalPrompt,
            cacheScope: req.cacheScope,
          }),
        )
        return {
          decision: result.decision,
          reason: result.reason,
          ...("review" in result ? { metadata: result.review } : {}),
        }
      },
    })

    return {
      "chat.message": async ({ sessionID }) => {
        clearDynamicLists(`${input.directory}\0${sessionID}`)
      },
    }
  }
}
