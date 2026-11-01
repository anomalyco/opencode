import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { ai } from "../../src/effect.js"
import { Azure } from "../../src/providers.js"
import { LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"

const send = (model: ReturnType<typeof Azure.messagesModel>) =>
  Effect.gen(function* () {
    const seen: Array<Request> = []
    yield* LLMClient.generate(ai.request({ model, prompt: "Hi" })).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            seen.push(yield* HttpClientRequest.toWeb(input.request))
            return input.respond("", { headers: { "content-type": "text/event-stream" } })
          }),
        ),
      ),
      Effect.flip,
    )
    return seen[0]!
  })

describe("Azure Messages", () => {
  it.effect("sends Anthropic Messages to the Foundry resource with x-api-key", () =>
    Effect.gen(function* () {
      const request = yield* send(Azure.messagesModel("claude-haiku-4-5", { resourceName: "fixture", apiKey: "key" }))

      expect(request.url).toBe("https://fixture.services.ai.azure.com/anthropic/v1/messages")
      expect(request.headers.get("x-api-key")).toBe("key")
      expect(request.headers.get("api-key")).toBeNull()
      expect(request.headers.get("anthropic-version")).toBe("2023-06-01")
    }),
  )

  it.effect("uses a configured baseURL as is", () =>
    Effect.gen(function* () {
      const request = yield* send(
        Azure.configure({ baseURL: "https://gateway.example/anthropic/v1/", apiKey: "key" }).messages("claude"),
      )

      expect(request.url).toBe("https://gateway.example/anthropic/v1/messages")
    }),
  )
})
