import type { Plugin } from "@opencode-ai/plugin"

/**
 * Test plugin that switches models based on prompt complexity
 * This demonstrates the power of the prompt.before hook for dynamic model selection
 */
export const ModelSwitcherPlugin: Plugin = async ({ directory }) => {
  console.log("[ModelSwitcher] Plugin loaded from:", directory)

  return {
    "prompt.before": async (input, output) => {
      const promptLower = input.prompt.toLowerCase()

      // Simple task detection
      const isSimpleTask =
        promptLower.includes("fix typo") ||
        promptLower.includes("simple") ||
        promptLower.includes("quick") ||
        promptLower.includes("small change") ||
        input.prompt.length < 50

      // Complex task detection
      const isComplexTask =
        promptLower.includes("refactor") ||
        promptLower.includes("architecture") ||
        promptLower.includes("design") ||
        promptLower.includes("implement") ||
        promptLower.includes("complex") ||
        input.prompt.length > 500

      console.log("\n🔄 MODEL SWITCHER ANALYSIS:")
      console.log("  Prompt:", input.prompt.substring(0, 80))
      console.log("  Current model:", input.model ? `${input.model.providerID}/${input.model.modelID}` : "default")

      if (isSimpleTask) {
        // Use a cheaper/faster model for simple tasks
        output.model = {
          providerID: "anthropic",
          modelID: "claude-haiku-3-5",
        }
        console.log("  ✅ Switched to Claude Haiku (simple task)")
      } else if (isComplexTask) {
        // Use a more powerful model for complex tasks
        output.model = {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
        }
        console.log("  ✅ Switched to Claude Sonnet 4.5 (complex task)")
      } else {
        console.log("  ℹ️  Using default model (medium complexity)")
      }

      // Example: Inject additional context for architectural tasks
      if (promptLower.includes("architecture")) {
        output.additionalContext =
          "Note: This is an architectural task. Consider scalability, maintainability, and best practices."
        console.log("  📝 Injected architectural guidance")
      }

      console.log("")
    },
  }
}
