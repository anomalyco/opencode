import type { Hooks, PluginInput } from "@opencode-ai/plugin"

// Microsoft Foundry auth plugin.
//
// Foundry exposes models behind project-scoped URLs of the form:
//   https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1
// authenticated via either `Authorization: Bearer <key>` or `api-key: <key>`.
//
// Deployments are user-defined (e.g. `gpt-5.5`, `gpt-4o-mini`) and not present in
// the models.dev catalog, so the user supplies them as part of `/login` and then
// references them in their own `opencode.json` provider entry. Example:
//
//   {
//     "provider": {
//       "foundry": {
//         "npm": "@ai-sdk/openai-compatible",
//         "options": {
//           "baseURL": "https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1"
//         },
//         "models": { "gpt-5.5": { "name": "GPT-5.5", "reasoning": false } }
//       }
//     }
//   }
//
// Foundry rejects some params that the openai-compatible SDK emits for gpt-5.x
// deployments (`reasoningSummary`, `reasoningEffort`, `textVerbosity`) plus
// `max_tokens` (must be `max_completion_tokens`, which the SDK doesn't rename).
// The `chat.params` hook strips them when the provider id is `foundry`.
export async function FoundryAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "foundry",
      methods: [
        {
          type: "api",
          label: "API key",
          prompts: [
            {
              type: "text",
              key: "resourceName",
              message: "Foundry resource hostname",
              placeholder: "e.g. faraday-resource.services.ai.azure.com",
              validate: (value: string) => (value.includes(".") ? undefined : "Must be a fully-qualified hostname"),
            },
            {
              type: "text",
              key: "projectName",
              message: "Foundry project name",
              placeholder: "e.g. faraday-agents",
              validate: (value: string) => (value.trim() ? undefined : "Project name is required"),
            },
            {
              type: "text",
              key: "deployments",
              message: "Deployment names (comma-separated, used in opencode.json)",
              placeholder: "e.g. gpt-5.5,gpt-4o-mini",
            },
          ],
        },
      ],
    },

    "chat.params": async (incoming, output) => {
      if (incoming.model.providerID !== "foundry") return
      const opts = output.options as Record<string, any> | undefined
      if (opts) {
        delete opts.reasoningEffort
        delete opts.reasoningSummary
        delete opts.textVerbosity
        delete opts.include
        delete opts.promptCacheKey
      }
      // The openai-compatible SDK emits `max_tokens`; gpt-5.x Foundry deployments
      // require `max_completion_tokens` instead. Dropping the cap lets the model
      // use its default output budget rather than failing the request.
      output.maxOutputTokens = undefined
    },
  }
}
