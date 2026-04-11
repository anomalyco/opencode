import type { Provider } from "../provider"

export type Family =
  | "generic"
  | "openai"
  | "azure"
  | "copilot"
  | "openai-compatible"
  | "openrouter"
  | "gateway"
  | "google"
  | "anthropic"
  | "bedrock"
  | "groq"
  | "xai"
  | "venice"
  | "opencode"
  | "sap"
  | "mistral"
  | "custom"

export function kind(model: Provider.Model): Family {
  switch (model.api.npm) {
    case "@ai-sdk/cerebras":
    case "@ai-sdk/togetherai":
    case "@ai-sdk/deepinfra":
      return "generic"
    case "@ai-sdk/openai":
      return "openai"
    case "@ai-sdk/azure":
      return "azure"
    case "@ai-sdk/github-copilot":
      return "copilot"
    case "@ai-sdk/openai-compatible":
      return "openai-compatible"
    case "@openrouter/ai-sdk-provider":
      return "openrouter"
    case "@ai-sdk/gateway":
      return "gateway"
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return "google"
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return "anthropic"
    case "@ai-sdk/amazon-bedrock":
      return "bedrock"
    case "@ai-sdk/groq":
      return "groq"
    case "@ai-sdk/xai":
      return "xai"
    case "venice-ai-sdk-provider":
      return "venice"
    case "@jerome-benoit/sap-ai-provider-v2":
      return "sap"
    case "@ai-sdk/mistral":
      return "mistral"
    default:
      // Some providers sit on top of generic SDK adapters (for example
      // openai-compatible) and need a family decision based on providerID/model
      // identity rather than the npm package alone.
      if (model.providerID === "venice") return "venice"
      if (model.providerID.startsWith("opencode")) return "opencode"
      if (
        model.providerID === "mistral" ||
        model.api.id.toLowerCase().includes("mistral") ||
        model.api.id.toLowerCase().includes("devstral")
      ) {
        return "mistral"
      }
      return "custom"
  }
}
