import type { PromptResponse } from "@agentclientprotocol/sdk"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import path from "node:path"
import { createAcpFixture, expectOk, initialize, newSession, toolCallStream } from "./subprocess"

const modelRequest = Schema.decodeUnknownSync(Schema.Struct({ messages: Schema.Array(Schema.Unknown) }))
const sessionUpdate = Schema.decodeUnknownSync(Schema.Struct({ update: Schema.Record(Schema.String, Schema.Unknown) }))

const windows = process.platform === "win32"
// Runs until the test creates `release` in the session directory, so the command ends after end_turn.
const releasedCommand = windows
  ? "while (!(Test-Path release)) { Start-Sleep -Milliseconds 50 }; 'slow shell done'"
  : "while [ ! -f release ]; do sleep 0.05; done; echo slow shell done"
// Exits at once, so its notice can arrive before the call's result or within the turn that started it.
const fastCommand = windows ? "'fast shell done'" : "echo fast shell done"

test("streams turns woken by background shells and keeps the session usable", async () => {
  const woken = Promise.withResolvers<void>()
  await using fixture = await createAcpFixture({
    respond(request) {
      const last = JSON.stringify(modelRequest(request).messages.at(-1))
      if (last.includes("<shell") && last.includes("slow shell done")) {
        woken.resolve()
        return "slow shell reaction"
      }
      if (last.includes("<shell") && last.includes("fast shell done")) return "fast shell reaction"
      if (last.includes("run the slow shell"))
        return toolCallStream("call_slow", "shell", { command: releasedCommand, description: "Slow", background: true })
      if (last.includes("run the fast shell"))
        return toolCallStream("call_fast", "shell", { command: fastCommand, description: "Fast", background: true })
      if (last.includes("follow up")) return "follow-up reply"
      return "launched"
    },
  })
  const acp = fixture.spawn()
  await initialize(acp)
  const { sessionId } = await newSession(acp, fixture.home)
  const prompt = (text: string) =>
    acp.request<PromptResponse>("session/prompt", { sessionId, prompt: [{ type: "text", text }] }).then(expectOk)
  const update = (description: string, match: (update: Record<string, unknown>) => boolean) =>
    acp
      .waitForMessage(
        (message) => message.method === "session/update" && match(sessionUpdate(message.params).update),
        description,
      )
      .then((message) => sessionUpdate(message.params).update)
  const chunk = (text: string) =>
    update(
      `the "${text}" agent_message_chunk`,
      (item) => item.sessionUpdate === "agent_message_chunk" && JSON.stringify(item).includes(text),
    )

  // The prompt ends while its shell still runs; the shell's notice later wakes a turn the client is shown.
  expect((await prompt("run the slow shell")).stopReason).toBe("end_turn")
  const launched = await chunk("launched")
  await update(
    "the slow shell's completed call",
    (item) => item.toolCallId === "call_slow" && item.status === "completed",
  )
  await Bun.write(path.join(fixture.home, "release"), "")
  await woken.promise
  const reaction = await chunk("slow shell reaction")
  expect(reaction.messageId).not.toBe(launched.messageId)

  // A shell that is done before its turn is: its reaction streams whether it lands in that turn or wakes another.
  expect((await prompt("run the fast shell")).stopReason).toBe("end_turn")
  await chunk("fast shell reaction")

  expect((await prompt("follow up")).stopReason).toBe("end_turn")
  await chunk("follow-up reply")
}, 60_000)

test("streams the parent's response to a subagent report after end_turn", async () => {
  const child = Promise.withResolvers<string>()
  const resumed = Promise.withResolvers<void>()
  await using fixture = await createAcpFixture({
    respond(request) {
      const last = JSON.stringify(modelRequest(request).messages.at(-1))
      if (last.includes("<subagent") && last.includes("child result")) {
        resumed.resolve()
        return "parent reaction"
      }
      if (last.includes("run the child"))
        return toolCallStream("call_child", "subagent", {
          agent: "general",
          description: "Background task",
          prompt: "work in child session",
        })
      if (last.includes("work in child session")) return child.promise
      return "launched"
    },
  })
  const acp = fixture.spawn()
  await initialize(acp)
  const { sessionId } = await newSession(acp, fixture.home)
  const response = expectOk(
    await acp.request<PromptResponse>("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "run the child" }],
    }),
  )
  expect(response.stopReason).toBe("end_turn")
  child.resolve("child result")
  await resumed.promise
  const message = await acp.waitForMessage(
    (message) => message.method === "session/update" && JSON.stringify(message.params).includes("parent reaction"),
    "the resumed parent's agent_message_chunk",
  )
  expect(message.params).toMatchObject({
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "parent reaction" } },
  })
}, 60_000)
