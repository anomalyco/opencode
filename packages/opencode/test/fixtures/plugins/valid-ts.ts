export const ValidTSPlugin = async (context: any) => {
  return {
    event: async () => {
      // Test event handler
    },
    "chat.message": async (_input: any, output: any) => {
      output.message = { ...output.message, testFlag: "ts-plugin" }
    },
    "tool.execute.before": async (_input: any, output: any) => {
      output.args = { ...output.args, testFlag: "ts-plugin" }
    },
  }
}

export const AnotherValidPlugin = async (context: any) => {
  return {
    "permission.ask": async (_input: any, output: any) => {
      output.status = "allow"
    },
  }
}
