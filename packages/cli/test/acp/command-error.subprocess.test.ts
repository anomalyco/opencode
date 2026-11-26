import type { PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { createAcpFixture, expectOk, initialize, newSession } from "./subprocess"

const sessionUpdate = Schema.decodeUnknownSync(Schema.Struct({ update: Schema.Record(Schema.String, Schema.Unknown) }))

describe("acp slash-command errors subprocess", () => {
  test("a bare /goal surfaces its usage message and ends the turn", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const response = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "/goal" }],
      }),
    )

    expect(response.stopReason).toBe("end_turn")
    const message = await acp.waitForMessage(
      (message) =>
        message.method === "session/update" && JSON.stringify(message.params).includes('"agent_message_chunk"'),
      "the bare /goal usage message chunk",
    )
    const update = sessionUpdate(message.params).update
    expect(update).toMatchObject({ sessionUpdate: "agent_message_chunk", content: { type: "text" } })
    expect(JSON.stringify(update)).toContain("Usage: /goal")
  }, 60_000)
})
