import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { RtkBinary } from "@/rtk/binary"

export async function rewriteCommand(command: string, binary?: string) {
  return RtkBinary.rewrite(command, binary)
}

export const RtkPlugin: Plugin = async (_input) => {
  if (RtkBinary.disabled()) return {}

  let binary: string | undefined
  try {
    binary = await RtkBinary.ensure()
  } catch (error) {
    console.warn("[rtk] failed to install bundled RTK binary — plugin disabled", error)
    return {}
  }

  const hooks: Hooks = {
    "tool.execute.before": async (input, output) => {
      const tool = String(input.tool).toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = output.args
      if (!args || typeof args !== "object") return
      const command = (args as Record<string, unknown>).command
      if (typeof command !== "string" || !command) return
      try {
        ;(args as Record<string, unknown>).command = await rewriteCommand(command, binary)
      } catch {
        // rtk rewrite failed — pass through unchanged
      }
    },
  }

  return hooks
}
