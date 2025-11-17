import type { Plugin } from "@opencode-ai/plugin"

export const TestPlugin: Plugin = async () => {
  console.log("🎯 Test Plugin Loaded!")

  return {
    "prompt.before": async (input, output) => {
      console.log("\n" + "=".repeat(60))
      console.log("🔥 PROMPT.BEFORE HOOK FIRED!")
      console.log("=".repeat(60))
      console.log("Session:", input.sessionID)
      console.log("Agent:", input.agent)
      console.log("Prompt:", input.prompt.substring(0, 100))
      console.log("Prompt length:", input.prompt.length)
      console.log("Current model:", input.model || "default")
      console.log("=".repeat(60) + "\n")

      // Test: switch to Haiku for "simple" prompts
      if (input.prompt.toLowerCase().includes("simple")) {
        output.model = {
          providerID: "anthropic",
          modelID: "claude-haiku-3-5"
        }
        console.log("✅ SWITCHED TO HAIKU FOR SIMPLE TASK\n")
      }

      // Test: switch to Sonnet for "complex" prompts
      if (input.prompt.toLowerCase().includes("complex") || input.prompt.toLowerCase().includes("refactor")) {
        output.model = {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5"
        }
        console.log("✅ SWITCHED TO SONNET 4.5 FOR COMPLEX TASK\n")
      }
    }
  }
}
