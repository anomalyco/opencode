import type { PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { ACPElicitation } from "../../src/acp/elicitation"
import { createAcpFixture, expectOk, initialize, newSession } from "./subprocess"

// The first completion asks a question; the follow-up completion ends the turn.
function askingModel(request: unknown) {
  if (JSON.stringify(request).includes('"role":"tool"')) return "done"
  return new Response(questionCall(), { headers: { "content-type": "text/event-stream" } })
}

function questionCall() {
  const call = { index: 0, id: "call_question", type: "function", function: { name: "question", arguments: "" } }
  const input = {
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
  }
  const chunks = [
    { choices: [{ delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }], usage: null },
    {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(input) } }] } }],
      usage: null,
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: null },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
  ]
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`
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
    expect(
      fixture.llm.requests.some((request) => JSON.stringify(request).includes(ACPElicitation.UnshownQuestionMessage)),
    ).toBe(true)
  }, 60_000)
})
