import { createBuiltinPlugins, type BuiltinTuiPlugin } from "@opencode-ai/tui/builtins"
import type { RuntimeFlags } from "@/effect/runtime-flags"

export type InternalTuiPlugin = BuiltinTuiPlugin

export function internalTuiPlugins(flags: Pick<RuntimeFlags.Info, "experimentalEventSystem">): InternalTuiPlugin[] {
  return createBuiltinPlugins({
    experimentalEventSystem: flags.experimentalEventSystem,
  })
}
