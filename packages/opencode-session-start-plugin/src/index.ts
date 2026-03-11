import { Plugin, tool } from "@opencode-ai/plugin"
import fs from "fs"
import path from "path"

export const SessionStartPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      testSessionStart: tool({
        description: "Test the session.start hook - returns status",
        args: {},
        async execute() {
          return "SessionStartPlugin loaded - check console for hook trigger"
        },
      }),
    },
    "session.start": async ({ sessionID, directory, projectID }, { context }) => {
      console.log("🎯 session.start hook FIRED!")
      console.log("  sessionID:", sessionID)
      console.log("  directory:", directory)
      console.log("  projectID:", projectID)

      const testContext = `[TEST] This context was injected by the session.start hook!
Session ID: ${sessionID}
Working Directory: ${directory}
Project ID: ${projectID}
Timestamp: ${new Date().toISOString()}`

      context.push(testContext)

      console.log("✅ Context injected into system prompt")
      console.log("   Context length:", context.join("\n").length, "chars")
    },
  }
}

export default SessionStartPlugin
