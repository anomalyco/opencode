import type { Plugin } from "@opencode-ai/plugin"

/**
 * Test plugin that logs all prompts before they're sent to the LLM
 * This verifies that the prompt.before hook is firing correctly
 */
export const PromptLoggerPlugin: Plugin = async ({ directory }) => {
  console.log("[PromptLogger] Plugin loaded from:", directory)

  return {
    "prompt.before": async (input, output) => {
      console.log("\n🎯 PROMPT INTERCEPTED BY LOGGER:")
      console.log("  Session ID:", input.sessionID)
      console.log("  Agent:", input.agent)
      console.log("  Prompt (first 100 chars):", input.prompt.substring(0, 100))
      console.log("  Prompt length:", input.prompt.length)
      console.log("  Current model:", input.model ? `${input.model.providerID}/${input.model.modelID}` : "default")
      console.log("  No reply:", input.noReply)
      console.log("")

      // Don't modify anything - just log
    },
  }
}
