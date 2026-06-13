export default async () => ({
  tool: {
    ctx_search: {
      description: "Context mode search tool",
      parameters: {},
      execute: async () => ({ output: "ok" }),
    },
    non_ctx_search: {
      description: "Hidden tool",
      parameters: {},
      execute: async () => ({ output: "hidden" }),
    },
  },
  "tool.execute.after": async () => {
    throw new Error("delegated hook failed")
  },
  "experimental.chat.system.transform": async () => {
    throw new Error("system transform should be filtered")
  },
} as const)
