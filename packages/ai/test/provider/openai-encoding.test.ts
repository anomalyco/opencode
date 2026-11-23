import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { ai, LanguageModel } from "../../src/effect.js"
import { LLMClient } from "../../src/route.js"
import { OpenAI } from "../../src/providers.js"
import { dynamicResponse } from "../lib/http.js"
import { it } from "../lib/effect.js"

// The content-encoding of the first request a model sends. The response doesn't matter.
const encoding = (model: LanguageModel, compact = false) =>
  Effect.gen(function* () {
    const seen: (string | null)[] = []
    const server = dynamicResponse((input) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
        seen.push(web.headers.get("content-encoding"))
        return input.respond("{}", { status: 500 })
      }),
    )
    const request = ai.request({ model, prompt: "Hello" })
    yield* (compact ? ai.compact(request) : LLMClient.generate(request)).pipe(Effect.provide(server), Effect.exit)
    return seen[0]
  })

describe("OpenAI request encoding", () => {
  it.effect("sends zstd to the ChatGPT backend by default", () =>
    Effect.gen(function* () {
      for (const baseURL of ["https://chatgpt.com/backend-api/codex", "https://chatgpt.com/backend-api/codex/"])
        expect(yield* encoding(OpenAI.model("gpt-6-astra", { apiKey: "test", baseURL }))).toBe("zstd")
    }),
  )

  it.effect(
    "sends plain JSON to OpenAI's API, another baseURL, Chat Completions, compaction, or when encoding is none",
    () =>
      Effect.gen(function* () {
        for (const baseURL of [undefined, "https://api.openai.com/v1"])
          expect(yield* encoding(OpenAI.model("gpt-6-astra", { apiKey: "test", baseURL }))).toBeNull()
        expect(
          yield* encoding(OpenAI.model("gpt-6-astra", { apiKey: "test", baseURL: "https://proxy.example/v1" })),
        ).toBeNull()
        const chatgpt = { apiKey: "test", baseURL: "https://chatgpt.com/backend-api/codex" }
        expect(yield* encoding(OpenAI.configure(chatgpt).chat("gpt-6-astra"))).toBeNull()
        // /responses/compact rejects compressed bodies.
        expect(yield* encoding(OpenAI.model("gpt-6-astra", chatgpt), true)).toBeNull()
        // How OpenCode applies a configured encoding: on the model's options, over the route default.
        const base = OpenAI.model("gpt-6-astra", chatgpt)
        const none = LanguageModel.update(base, {
          options: { ...base.options, http: { ...base.options?.http, encoding: "none" } },
        })
        expect(yield* encoding(none)).toBeNull()
      }),
  )
})
