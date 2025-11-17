import type { Plugin } from "@opencode-ai/plugin"

/**
 * Test plugin that demonstrates blocking prompts
 * This can be used for content filtering, rate limiting, or custom validation
 */
export const PromptBlockerPlugin: Plugin = async ({ directory }) => {
  console.log("[PromptBlocker] Plugin loaded from:", directory)

  return {
    "prompt.before": async (input, output) => {
      const promptLower = input.prompt.toLowerCase()

      // Example: Block prompts containing sensitive keywords
      const sensitiveKeywords = ["delete all", "drop database", "rm -rf /"]

      for (const keyword of sensitiveKeywords) {
        if (promptLower.includes(keyword)) {
          console.log("\n🚫 PROMPT BLOCKED:")
          console.log("  Reason: Contains sensitive keyword:", keyword)
          console.log("  Prompt:", input.prompt.substring(0, 100))
          console.log("")

          output.block = true
          output.blockReason = `Prompt blocked: contains potentially dangerous keyword "${keyword}"`
          return
        }
      }

      console.log("✅ Prompt passed security check")
    },
  }
}
