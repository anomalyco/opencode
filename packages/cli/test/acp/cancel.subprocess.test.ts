import type { CloseSessionResponse, PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize, newSession } from "./subprocess"

// The mock model holds any completion whose request mentions "hold" until the test releases it,
// so cancellation can be exercised while the model turn is genuinely in flight.
function heldModel() {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<string>()
  return {
    started: started.promise,
    release: () => release.resolve("released"),
    respond(request: unknown) {
      if (!JSON.stringify(request).includes("hold")) return "accepted"
      started.resolve()
      return release.promise
    },
  }
}

describe("acp cancel subprocess", () => {
  test("$/cancel_request cancels the in-flight prompt and the session stays usable", async () => {
    const model = heldModel()
    await using fixture = await createAcpFixture({ respond: model.respond })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const prompt = acp.send<PromptResponse>("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hold" }],
    })
    await model.started
    await acp.notify("$/cancel_request", { requestId: prompt.id })

    expect(expectOk(await prompt.response).stopReason).toBe("cancelled")
    model.release()
    const next = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "again" }],
      }),
    )
    expect(next.stopReason).toBe("end_turn")
  }, 60_000)

  test("session/close settles the active prompt before responding and leaves other sessions alone", async () => {
    const model = heldModel()
    await using fixture = await createAcpFixture({ respond: model.respond })
    const acp = fixture.spawn()
    await initialize(acp)
    const closing = await newSession(acp, fixture.home)
    const other = await newSession(acp, fixture.home)

    const prompt = acp.send<PromptResponse>("session/prompt", {
      sessionId: closing.sessionId,
      prompt: [{ type: "text", text: "hold" }],
    })
    await model.started
    const order: string[] = []
    const close = acp
      .request<CloseSessionResponse>("session/close", { sessionId: closing.sessionId })
      .then((response) => {
        order.push("close")
        return response
      })
    const cancelled = await prompt.response.then((response) => {
      order.push("prompt")
      return response
    })

    expect(expectOk(cancelled).stopReason).toBe("cancelled")
    expect(expectOk(await close)).toEqual({})
    expect(order).toEqual(["prompt", "close"])
    model.release()
    const next = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: other.sessionId,
        prompt: [{ type: "text", text: "still here" }],
      }),
    )
    expect(next.stopReason).toBe("end_turn")
  }, 60_000)
})
