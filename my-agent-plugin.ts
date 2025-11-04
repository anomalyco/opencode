import type { Plugin } from "@opencode-ai/plugin"

export const AgentCompletePlugin: Plugin = async (input) => {
  let completionCount = 0

  return {
    "agent.complete": async (input, output) => {
      completionCount++

      if (completionCount === 1) {
        output.continue = true
        output.prompt = "Now please list all files in the current directory"
      } else if (completionCount === 2) {
        output.continue = true
        output.prompt = "Great! Now tell me what is the current git status"
      } else {
      }
    },
  }
}
