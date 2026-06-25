import type { ModelsDev } from "@opencode-ai/schema/models-dev"

export const DaneelProviderCatalog = {
  "streamlake-kat-coding-plan": {
    id: "streamlake-kat-coding-plan",
    name: "StreamLake KAT Coding Plan International",
    env: ["STREAMLAKE_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://wanqing.streamlakeapi.com/api/gateway/coding/v1",
    models: {
      "kat-coder-pro-v2": {
        id: "kat-coder-pro-v2",
        name: "KAT Coder Pro V2",
        family: "kat-coder",
        release_date: "",
        attachment: false,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: {
          context: 256000,
          output: 32768,
        },
        modalities: {
          input: ["text"],
          output: ["text"],
        },
      },
    },
  },
} satisfies Record<string, ModelsDev.Provider>
