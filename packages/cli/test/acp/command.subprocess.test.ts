import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { createAcpFixture, expectOk, initialize, newSession, type AcpProcess } from "./subprocess"

const commandPlugin = path.join(import.meta.dir, "fixture/command-plugin")

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
    const pending = trackedPrompt(acp, session.sessionId, "/audit now")
    await gate.started
    await Bun.sleep(200)
    expect(pending.settled()).toBe(false)
    expect(lastUserText(fixture.llm.requests)).toBe("Audit now")

    gate.release("COMMAND_RESPONSE")
    const response = await pending.response
    expect(response.stopReason).toBe("end_turn")
    const chunk = await acp.waitForNotification<SessionNotification>("session/update", (params) =>
      isAgentText(params, "COMMAND_RESPONSE"),
    )
    expect(chunk.params.sessionId).toBe(session.sessionId)
  }, 60_000)

  test("built-in /init prompt command waits for the model response", async () => {
    const script = scriptedModel()
    await using fixture = await createAcpFixture({ respond: script.respond })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const gate = script.hold()
    const pending = trackedPrompt(acp, session.sessionId, "/init")
    await gate.started
    await Bun.sleep(200)
    expect(pending.settled()).toBe(false)
    expect(lastUserText(fixture.llm.requests)).toContain("AGENTS.md")

    gate.release("INIT_RESPONSE")
    expect((await pending.response).stopReason).toBe("end_turn")
    await acp.waitForNotification<SessionNotification>("session/update", (params) =>
      isAgentText(params, "INIT_RESPONSE"),
    )
  }, 60_000)

  test("immediate plugin commands finish without model work", async () => {
    await using fixture = await createAcpFixture({ config: { plugins: [commandPlugin] } })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)
    const commands = await acp.waitForNotification<SessionNotification>(
      "session/update",
      (params) => params.update.sessionUpdate === "available_commands_update",
    )
    expect(
      commands.params.update.sessionUpdate === "available_commands_update"
        ? commands.params.update.availableCommands.map((command) => command.name)
        : [],
    ).toEqual(expect.arrayContaining(["ping", "pong"]))

    for (const text of ["/ping", "/pong"]) {
      const response = expectOk(
        await acp.request<PromptResponse>("session/prompt", {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text }],
        }),
      )
      expect(response.stopReason).toBe("end_turn")
    }
    expect(fixture.llm.requests).toHaveLength(0)
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
    const pending = trackedPrompt(acp, session.sessionId, "/audit now")
    await child.started
    expect(lastUserText(fixture.llm.requests)).toBe("You are a subagent spawned by another session.\nAudit now")
    child.release("CHILD_DONE")
    await parent.started
    await Bun.sleep(200)
    expect(pending.settled()).toBe(false)
    expect(lastUserText(fixture.llm.requests)).toContain("CHILD_DONE")

    parent.release("PARENT_DONE")
    expect((await pending.response).stopReason).toBe("end_turn")
    const childChunk = await acp.waitForNotification<SessionNotification>("session/update", (params) =>
      isAgentText(params, "CHILD_DONE"),
    )
    expect(childChunk.params.sessionId).toBe(session.sessionId)
    expect(childChunk.params.update._meta?.["opencode/child-session"]).toMatchObject({ parentID: session.sessionId })
    const parentChunk = await acp.waitForNotification<SessionNotification>("session/update", (params) =>
      isAgentText(params, "PARENT_DONE"),
    )
    expect(parentChunk.params.update._meta?.["opencode/child-session"]).toBeUndefined()
  }, 60_000)

  test("cancelling during command work returns cancelled", async () => {
    const script = scriptedModel()
    await using fixture = await createAcpFixture({
      respond: script.respond,
      config: { commands: { audit: { description: "Audit the change", template: "Audit $ARGUMENTS" } } },
    })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const gate = script.hold()
    const pending = trackedPrompt(acp, session.sessionId, "/audit now")
    await gate.started
    await acp.notify("session/cancel", { sessionId: session.sessionId })

    expect((await pending.response).stopReason).toBe("cancelled")
    gate.release("LATE")
    const followUp = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello again" }],
      }),
    )
    expect(followUp.stopReason).toBe("end_turn")
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
    const pending = trackedPrompt(acp, session.sessionId, "/audit now")
    await child.started
    await acp.notify("session/cancel", { sessionId: session.sessionId })

    // The parent's follow-up run (from the cancelled subagent notice) can only settle before its
    // model response is released by being interrupted.
    expect((await pending.response).stopReason).toBe("cancelled")
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

function scriptedModel() {
  const holds: Array<{ started: () => void; released: Promise<string> }> = []
  return {
    respond: (request: unknown) => {
      // Auxiliary requests such as title generation carry no tools; only agent-loop steps take a hold.
      if (!isAgentStep(request)) return "accepted"
      const next = holds.shift()
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

function trackedPrompt(acp: AcpProcess, sessionId: string, text: string) {
  let done = false
  const response = acp
    .request<PromptResponse>("session/prompt", { sessionId, prompt: [{ type: "text", text }] })
    .then(expectOk)
    .finally(() => {
      done = true
    })
  return { response, settled: () => done }
}

function isAgentText(params: SessionNotification, text: string) {
  return (
    params.update.sessionUpdate === "agent_message_chunk" &&
    params.update.content.type === "text" &&
    params.update.content.text === text
  )
}

function isAgentStep(request: unknown) {
  return !!request && typeof request === "object" && "tools" in request && Array.isArray(request.tools)
}

function lastUserText(requests: readonly unknown[]) {
  const last = requests.findLast(isAgentStep)
  if (!last || typeof last !== "object" || !("messages" in last) || !Array.isArray(last.messages)) return undefined
  const user = last.messages.findLast(
    (message: unknown) =>
      !!message && typeof message === "object" && "role" in message && message.role === "user" && "content" in message,
  )
  const content = user?.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content
    .flatMap((part: unknown) =>
      part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : [],
    )
    .join("")
}
