import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { confirm } from "@clack/prompts"

export async function createCliPermissionHandler(_input: PluginInput): Promise<Hooks> {
  return {
    "permission.ask": async (info: any, output) => {
      const patterns = Array.isArray(info.pattern) ? info.pattern : info.pattern ? [info.pattern] : [info.type]
      const message = `Permission required: ${info.type}${patterns.length > 0 ? ` (${patterns.join(", ")})` : ""}\n${info.title}`

      const result = await confirm({
        message,
        initialValue: false,
      }).catch(() => false)

      output.status = result ? "allow" : "deny"
    },
  }
}
