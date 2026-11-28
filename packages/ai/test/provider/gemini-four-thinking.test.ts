import { expect } from "bun:test"
import { Effect } from "effect"
import { ai } from "../../src/effect.js"
import { Google, GoogleVertex } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const neon = GoogleVertex.configure({
  accessToken: "fixture-token",
  location: "global",
  project: "fixture-project",
}).model("gemini-4-neon")
const hydrogen = Google.configure({ apiKey: "fixture-key" }).model("gemini-4-hydrogen")

const cases = [
  {
    name: "drops the dynamic budget from a Vertex Neon request",
    model: neon,
    thinkingConfig: { thinkingBudget: -1 },
    expected: { includeThoughts: true },
  },
  {
    name: "uses the lowest supported level for a disabled Vertex Neon budget",
    model: neon,
    thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
    expected: { thinkingLevel: "LOW", includeThoughts: false },
  },
  {
    name: "preserves explicit xhigh and drops a stale budget on Vertex Neon",
    model: neon,
    thinkingConfig: { thinkingBudget: 1024, thinkingLevel: "xhigh" },
    expected: { thinkingLevel: "xhigh", includeThoughts: true },
  },
  {
    name: "lowers minimal to LOW on the Gemini API for Hydrogen",
    model: hydrogen,
    thinkingConfig: { thinkingLevel: "minimal" },
    expected: { thinkingLevel: "LOW", includeThoughts: true },
  },
]

for (const { name, model, thinkingConfig, expected } of cases) {
  it.effect(name, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        ai.request({ model, prompt: "Say hello.", providerOptions: { thinkingConfig } }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              expect(input.request.url).toContain(`/models/${model.id}:streamGenerateContent`)
              expect(JSON.parse(input.text).generationConfig.thinkingConfig).toEqual(expected)
              return input.respond(
                sseEvents({
                  candidates: [{ content: { role: "model", parts: [{ text: "Hello." }] }, finishReason: "STOP" }],
                }),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello.")
    }),
  )
}
