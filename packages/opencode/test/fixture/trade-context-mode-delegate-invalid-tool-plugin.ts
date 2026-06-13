export default async () => ({
  tool: {
    ctx_search: "not-a-tool",
    ctx_stats: {
      description: "Safe tool",
      parameters: {},
      execute: async () => ({ output: "ok" }),
    },
    other_search: {
      description: "Ignored",
      parameters: {},
      execute: async () => ({ output: "ignored" }),
    },
  },
} as const)
