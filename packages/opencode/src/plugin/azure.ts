import type { Hooks, PluginInput } from "@opencode-ai/plugin"

function isAzureOpenAICompatibleGpt5(input: Parameters<NonNullable<Hooks["chat.params"]>>[0]) {
  if (input.model.api.npm !== "@ai-sdk/openai-compatible") return false
  if (!input.model.capabilities.reasoning) return false
  if (!input.model.api.id.toLowerCase().includes("gpt-5")) return false

  const baseURL = input.provider.options?.baseURL
  if (typeof baseURL !== "string" || baseURL.trim() === "") return false

  try {
    const hostname = new URL(baseURL).hostname.toLowerCase()
    return (
      hostname.endsWith(".services.ai.azure.com") ||
      hostname.endsWith(".openai.azure.com") ||
      hostname.endsWith(".cognitiveservices.azure.com")
    )
  } catch {
    return false
  }
}

export async function AzureAuthPlugin(_input: PluginInput): Promise<Hooks> {
  const prompts = []
  if (!process.env.AZURE_RESOURCE_NAME) {
    prompts.push({
      type: "text" as const,
      key: "resourceName",
      message: "Enter Azure Resource Name",
      placeholder: "e.g. my-models",
    })
  }

  return {
    auth: {
      provider: "azure",
      methods: [
        {
          type: "api",
          label: "API key",
          prompts,
        },
      ],
    },
    "chat.params": async (input, output) => {
      if (!isAzureOpenAICompatibleGpt5(input)) return

      // Azure OpenAI-compatible GPT-5 chat deployments reject `max_tokens`
      // and `reasoningSummary` on this path. Drop them and let Azure use the
      // model default output budget instead.
      output.maxOutputTokens = undefined
      delete output.options.reasoningSummary
    },
  }
}
