import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, Model } from "../src/effect.js"
import { apis } from "../src/apis.js"
import { OpenAI } from "../src/providers.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/testing.js"
import { it } from "./lib/effect.js"

describe("Model", () => {
  it.effect("describes a text model by its API, base URL and auth", () =>
    Effect.gen(function* () {
      const described = Model.make({
        type: "chat",
        id: "gpt-5.5",
        provider: "openai",
        api: apis.openaiResponses,
        baseURL: "https://api.openai.com/v1",
        auth: Auth.bearer("fixture"),
      })
      const fromRoute = apis.openaiResponses
        .with({ endpoint: { baseURL: "https://api.openai.com/v1" }, auth: Auth.bearer("fixture") })
        .model({ id: "gpt-5.5" })

      expect(described.baseURL).toBe("https://api.openai.com/v1")
      expect(described.route.endpoint.baseURL).toBe("https://api.openai.com/v1")
      expect((yield* compileRequest(ai.request({ model: described, prompt: "Hi" }))).body).toEqual(
        (yield* compileRequest(ai.request({ model: fromRoute, prompt: "Hi" }))).body,
      )
    }),
  )

  it.effect("moves a model to another base URL and keeps its auth", () =>
    Effect.gen(function* () {
      const model = OpenAI.configure({ apiKey: "fixture" }).chat("gpt-5.5")
      const moved = Model.with(model, { baseURL: "https://proxy.test/v1" })

      expect(moved.baseURL).toBe("https://proxy.test/v1")
      expect(moved.route.endpoint.baseURL).toBe("https://proxy.test/v1")
      expect(moved.auth).toBe(model.auth)
      expect(Model.with(moved, { api: model.api }).baseURL).toBe(model.baseURL)
      expect(Model.with(model, { path: "/v2/chat" }).route.endpoint.path).toBe("/v2/chat")
    }),
  )
})
