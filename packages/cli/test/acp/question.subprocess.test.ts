import type { PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize, newSession, toolCallStream } from "./subprocess"

const choice = {
  header: "Token storage",
  question: "Where should the app keep the API token?",
  options: [
    { label: "Keychain", description: "Use the system keychain" },
    { label: "Env file", description: "Read it from .env" },
  ],
}
const typed = { header: "API key", question: "Paste your API key", options: [] }

describe("acp question subprocess", () => {
  test("asks a choice question that mentions a secret and withholds a typed secret (https://github.com/anomalyco/opencode/issues/61283)", async () => {
    const asked = { question: choice }
    await using fixture = await createAcpFixture({
      respond: (request) => {
        if (lastMessage(request)?.role === "tool") return "done"
        return toolCallStream("call_question", "question", { questions: [asked.question] })
      },
    })
    const acp = fixture.spawn({
      onRequest: (method) =>
        method === "elicitation/create" ? { action: "accept", content: { q0: "Keychain" } } : undefined,
    })
    await initialize(acp, { elicitation: { form: {} } })
    const session = await newSession(acp, fixture.home)
    const prompt = () =>
      acp
        .request<PromptResponse>("session/prompt", {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "set up the client" }],
        })
        .then(expectOk)

    expect((await prompt()).stopReason).toBe("end_turn")
    const elicitations = acp.received.filter((message) => message.method === "elicitation/create")
    expect(elicitations).toHaveLength(1)
    expect(elicitations[0].params).toMatchObject({
      mode: "form",
      requestedSchema: { properties: { q0: { title: "Token storage" } } },
    })
    expect(
      Object.keys((elicitations[0].params as { requestedSchema: { properties: object } }).requestedSchema.properties),
    ).toEqual(["q0"])
    expect(lastMessage(fixture.llm.requests.at(-1))?.content).toContain(
      '"Where should the app keep the API token?"="Keychain"',
    )

    asked.question = typed
    expect((await prompt()).stopReason).toBe("end_turn")
    expect(acp.received.filter((message) => message.method === "elicitation/create")).toHaveLength(1)
    expect(lastMessage(fixture.llm.requests.at(-1))?.content).toContain(
      "asks for a typed answer that might be a secret",
    )
  }, 60_000)
})

function lastMessage(request: unknown) {
  return (request as { messages: { role: string; content: string }[] }).messages.at(-1)
}
