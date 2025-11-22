import { describe, expect, test } from "bun:test"
import { ACPOrchestrator } from "../../src/acp/orchestrator"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"

describe.skip("ACPOrchestrator (integration)", () => {
  test("should send a simple prompt and get a response", async () => {
    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        const sessionID = "test-session-" + Date.now()

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
})
