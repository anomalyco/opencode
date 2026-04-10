export const PROVIDER_OVERRIDES = {
  groq: {
    models: {
      compound: {
        tool_call: false,
      },
      "compound-mini": {
        tool_call: false,
      },
      "llama-3.3-70b-versatile": {
        status: "deprecated",
      },
      "llama-3.1-8b-instant": {
        status: "deprecated",
      },
      "meta-llama/llama-4-maverick-17b-128e-instruct": {
        status: "deprecated",
      },
      "meta-llama/llama-guard-4-12b": {
        tool_call: false,
        runtime: {
          disable_local_tools: true,
        },
      },
      "moonshotai/kimi-k2-instruct-0905": {
        limit: {
          output: 4096,
        },
      },
      "qwen3-32b": {
        status: "deprecated",
      },
    },
  },
} as const
