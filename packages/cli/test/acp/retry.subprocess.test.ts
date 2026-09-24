import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize, newSession } from "./subprocess"

describe("acp retry subprocess", () => {
  test("reports provider retries during the turn and on cancellation", async () => {
    await using fixture = await createAcpFixture({
      respond: () =>
        Response.json(
          { error: { message: "rate-limited upstream", type: "rate_limit_error" } },
          // A long backoff keeps the retry pending until the cancel lands.
          { status: 429, headers: { "retry-after": "30" } },
        ),
    })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const prompt = acp.send<PromptResponse>("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })
    const scheduled = await acp.waitForNotification<SessionNotification>(
      "session/update",
      (params) => params.sessionId === session.sessionId && params.update.sessionUpdate === "session_info_update",
    )
    const retry = scheduled.params.update._meta?.["opencode/retry"]
    expect(retry).toMatchObject({ attempt: 2, error: { message: expect.stringContaining("rate-limited upstream") } })

    await acp.notify("session/cancel", { sessionId: session.sessionId })
    const response = expectOk(await prompt.response)
    expect(response.stopReason).toBe("cancelled")
    expect(response._meta?.["opencode/retry"]).toEqual(retry)
  }, 60_000)
})
