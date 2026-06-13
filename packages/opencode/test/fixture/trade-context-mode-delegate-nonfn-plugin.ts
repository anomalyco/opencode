export default async () => ({
  tool: {
    ctx_search: {
      description: "Non-function fallback test tool",
      parameters: {},
      execute: async () => ({ output: "ok" }),
    },
  },
  "tool.execute.after": "not-a-hook",
} as const)
