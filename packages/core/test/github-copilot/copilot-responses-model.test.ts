import { OpenAIResponsesLanguageModel } from "@opencode/core/github-copilot/responses/openai-responses-language-model"
import { afterAll, describe, expect, test } from "bun:test"

const bodies: unknown[] = []
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    bodies.push(await request.json())
    return new Response("", { headers: { "Content-Type": "text/event-stream" } })
  },
})
afterAll(() => server.stop())

async function requestBody(modelID: string) {
  const model = new OpenAIResponsesLanguageModel(modelID, {
    provider: "copilot.responses",
    url: ({ path }) => new URL(path, server.url).href,
    headers: () => ({ Authorization: "Bearer test-token" }),
  })
  await model.doStream({
    prompt: [
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ],
    temperature: 0.5,
    providerOptions: { copilot: { reasoningEffort: "high" } },
  })
  return bodies.at(-1)
}

describe("reasoning model detection", () => {
  for (const id of ["gpt-5.5", "gpt-6-sol", "gpt-6.1-astra", "gpt-7"]) {
    test(`treats ${id} as a reasoning model`, async () => {
      const body = await requestBody(id)
      expect(body).toMatchObject({
        reasoning: { effort: "high" },
        input: [{ role: "developer", content: "Be brief." }, { role: "user" }],
      })
      expect(body).not.toHaveProperty("temperature")
    })
  }

  for (const id of ["gpt-4.1", "gpt-5-chat-latest"]) {
    test(`treats ${id} as a non-reasoning model`, async () => {
      const body = await requestBody(id)
      expect(body).not.toHaveProperty("reasoning")
      expect(body).toMatchObject({
        temperature: 0.5,
        input: [{ role: "system", content: "Be brief." }, { role: "user" }],
      })
    })
  }
})
