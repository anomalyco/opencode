export const ValidJSPlugin = async (context) => {
  return {
    event: async () => {
      // Test event handler for JS plugin
    },
    "chat.params": async (_input, output) => {
      output.temperature = 0.5
    },
    "tool.execute.after": async (_input, output) => {
      output.metadata = { ...output.metadata, jsPlugin: true }
    },
  }
}

export const SimpleJSPlugin = async (context) => {
  return {
    "permission.ask": async (_input, output) => {
      output.status = "deny"
    },
  }
}
