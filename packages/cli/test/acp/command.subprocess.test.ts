import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize, lastUserText, newSession, type ChatRequest } from "./subprocess"

describe("acp slash command subprocess", () => {
  test("template command stays pending until its model work completes and streams the output", async () => {
    const script = scriptedModel()
    await using fixture = await createAcpFixture({
      respond: script.respond,
      config: { commands: { audit: { description: "Audit the change", template: "Audit $ARGUMENTS" } } },
    })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const gate = script.hold()
    const pending = acp
      .request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "/audit now" }],
      })
      .then(expectOk)
    await gate.started
    expect(lastUserText(fixture.llm.requests.at(-1)!)).toBe("Audit now")
    // The response is held, so the prompt must still be pending.
    expect(await Promise.race([pending.then(() => "settled"), Bun.sleep(200).then(() => "pending")])).toBe("pending")

    gate.release("COMMAND_RESPONSE")
    expect((await pending).stopReason).toBe("end_turn")
    const chunk = await acp.waitForNotification<SessionNotification>("session/update", (params) =>
      isAgentText(params, "COMMAND_RESPONSE"),
    )
    expect(chunk.params.sessionId).toBe(session.sessionId)
  }, 60_000)

  test("subagent command follows the child and the parent's follow-up before completing", async () => {
    const script = scriptedModel()
    await using fixture = await createAcpFixture({
      respond: script.respond,
      config: {
        commands: { audit: { description: "Audit in a subagent", template: "Audit $ARGUMENTS", subagent: true } },
      },
    })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const child = script.hold()
    const parent = script.hold()
    const pending = acp
      .request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "/audit now" }],
      })
      .then(expectOk)
    await child.started
    expect(lastUserText(fixture.llm.requests.at(-1)!)).toBe("You are a subagent spawned by another session.\nAudit now")
    child.release("CHILD_DONE")
    await parent.started
    expect(lastUserText(fixture.llm.requests.at(-1)!)).toContain("CHILD_DONE")
    expect(await Promise.race([pending.then(() => "settled"), Bun.sleep(200).then(() => "pending")])).toBe("pending")

    parent.release("PARENT_DONE")
    expect((await pending).stopReason).toBe("end_turn")
    const childChunk = await acp.waitForNotification<SessionNotification>("session/update", (params) =>
      isAgentText(params, "CHILD_DONE"),
    )
    expect(childChunk.params.update._meta?.["opencode/child-session"]).toMatchObject({ parentID: session.sessionId })
    const parentChunk = await acp.waitForNotification<SessionNotification>("session/update", (params) =>
      isAgentText(params, "PARENT_DONE"),
    )
    expect(parentChunk.params.update._meta?.["opencode/child-session"]).toBeUndefined()
  }, 60_000)

  test("cancelling during subagent command work interrupts the child and the parent's follow-up", async () => {
    const script = scriptedModel()
    await using fixture = await createAcpFixture({
      respond: script.respond,
      config: {
        commands: { audit: { description: "Audit in a subagent", template: "Audit $ARGUMENTS", subagent: true } },
      },
    })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const child = script.hold()
    const parent = script.hold()
    const pending = acp
      .request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "/audit now" }],
      })
      .then(expectOk)
    await child.started
    await acp.notify("session/cancel", { sessionId: session.sessionId })

    // Both model responses stay held, so the prompt can only settle by interrupting the child and
    // the parent's follow-up run that the cancelled-subagent notice wakes.
    expect((await pending).stopReason).toBe("cancelled")
    child.release("LATE")
    parent.release("LATE")
    const followUp = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello again" }],
      }),
    )
    expect(followUp.stopReason).toBe("end_turn")
  }, 60_000)
})

/** Holds agent-loop model responses in FIFO order; auxiliary requests (no tools) answer immediately. */
function scriptedModel() {
  const holds: Array<{ started: () => void; released: Promise<string> }> = []
  return {
    respond: (request: ChatRequest) => {
      const next = request.tools ? holds.shift() : undefined
      if (!next) return "accepted"
      next.started()
      return next.released
    },
    hold() {
      const started = Promise.withResolvers<void>()
      const released = Promise.withResolvers<string>()
      holds.push({ started: started.resolve, released: released.promise })
      return { started: started.promise, release: released.resolve }
    },
  }
}

function isAgentText(params: SessionNotification, text: string) {
  return (
    params.update.sessionUpdate === "agent_message_chunk" &&
    params.update.content.type === "text" &&
    params.update.content.text === text
  )
}
