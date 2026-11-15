import type { PromptResponse } from "@agentclientprotocol/sdk"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { createAcpFixture, expectOk, initialize, newSession, toolCallStream } from "./subprocess"

const modelRequest = Schema.decodeUnknownSync(Schema.Struct({ messages: Schema.Array(Schema.Unknown) }))

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
