import type { PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { ACPElicitation } from "../../src/acp/elicitation"
import { createAcpFixture, expectOk, initialize, newSession, toolCallStream } from "./subprocess"

const ChatRequest = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({ role: Schema.String, tool_call_id: Schema.optional(Schema.String), content: Schema.Unknown }),
  ),
})

// The first completion asks a question; the follow-up completion ends the turn.
function askingModel(request: unknown) {
  if (JSON.stringify(request).includes('"role":"tool"')) return "done"
  return toolCallStream("call_question", "question", {
    questions: [
      {
        header: "Runtime",
        question: "Which runtime?",
        options: [
          { label: "Bun", description: "Fast" },
          { label: "Node", description: "Stable" },
        ],
      },
    ],
  })
}

describe("acp question subprocess", () => {
  test("a question the client cannot show returns to the model and the turn continues", async () => {
    await using fixture = await createAcpFixture({ respond: askingModel })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const result = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "ask me something" }],
      }),
    )

    expect(result.stopReason).toBe("end_turn")
    const results = fixture.llm.requests
      .flatMap((request) => Option.toArray(Schema.decodeUnknownOption(ChatRequest)(request)))
      .flatMap((request) => request.messages)
      .filter((message) => message.role === "tool" && message.tool_call_id === "call_question")
    expect(results).toHaveLength(1)
    expect(String(results[0]?.content)).toContain(ACPElicitation.UnshownQuestionMessage)
  }, 60_000)
})
