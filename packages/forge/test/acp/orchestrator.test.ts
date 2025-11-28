import { describe, expect, test } from "bun:test"
import { ACPOrchestrator } from "../../src/acp/orchestrator"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { hasClaudeApiKey } from "./helpers"
import { Identifier } from "../../src/id/id"

// Skip integration tests if ANTHROPIC_API_KEY is not set
const describeIntegration = hasClaudeApiKey() ? describe : describe.skip

describeIntegration("ACPOrchestrator (integration with claude-code-acp)", () => {
  test("should send a simple prompt and get a response", async () => {
    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        const sessionID = Identifier.ascending("session")

        try {
          const result = await ACPOrchestrator.sendPrompt({
            sessionID,
            parts: [
              {
                type: "text",
                text: "What is 2+2? Please respond with just the number.",
              },
            ],
          })

          console.log("Response:", result)

          expect(result).toBeDefined()
          expect(result.info).toBeDefined()
          expect(result.info.role).toBe("assistant")
        } finally {
          await ACPOrchestrator.cleanup(sessionID)
        }
      },
    })
  }, 30000) // 30 second timeout

  test("should handle multiple prompts in same session", async () => {
    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        const sessionID = Identifier.ascending("session")

        try {
          // First prompt
          const result1 = await ACPOrchestrator.sendPrompt({
            sessionID,
            parts: [
              {
                type: "text",
                text: "What is 3+3?",
              },
            ],
          })

          expect(result1).toBeDefined()
          expect(result1.info.role).toBe("assistant")

          // Second prompt in same session
          const result2 = await ACPOrchestrator.sendPrompt({
            sessionID,
            parts: [
              {
                type: "text",
                text: "What is 4+4?",
              },
            ],
          })

          expect(result2).toBeDefined()
          expect(result2.info.role).toBe("assistant")
        } finally {
          await ACPOrchestrator.cleanup(sessionID)
        }
      },
    })
  }, 60000) // 60 second timeout for multiple prompts
})
