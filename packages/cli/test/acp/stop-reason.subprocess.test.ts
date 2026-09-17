import type { PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize, newSession } from "./subprocess"

describe("acp stop reason subprocess", () => {
  // Natural completion already reports end_turn throughout the other subprocess tests.
  test("reports max_turn_requests when the agent's step allowance forces the final step", async () => {
    await using fixture = await createAcpFixture({ config: { agents: { build: { steps: 1 } } } })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const response = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello" }],
      }),
    )
    expect(response.stopReason).toBe("max_turn_requests")
  }, 60_000)
})
