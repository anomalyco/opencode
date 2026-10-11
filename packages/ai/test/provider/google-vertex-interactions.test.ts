import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { HttpClientRequest } from "effect/http"
import { LLM, Message, ToolCallPart } from "../../src/index.js"
import { GoogleVertexInteractions } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { Auth } from "../../src/route/auth.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("Google Vertex Interactions", () => {
  it.effect("streams through the global project endpoint with OAuth and Vertex service tiers", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: GoogleVertexInteractions.configure({
            accessToken: "vertex-token",
            location: "global",
            project: "vertex-project",
          }).model("gemini-3.8-flash"),
          system: "Be concise.",
          prompt: "Say hello.",
          providerOptions: { serviceTier: "flex", thinkingLevel: "low" },
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(request.url).toBe(
                "https://aiplatform.googleapis.com/v1beta1/projects/vertex-project/locations/global/interactions?alt=sse",
              )
              expect(request.method).toBe("POST")
              expect(request.headers.get("authorization")).toBe("Bearer vertex-token")
              expect(request.headers.has("x-goog-api-key")).toBe(false)
              expect(request.headers.get("x-vertex-ai-llm-shared-request-type")).toBe("flex")
              expect(yield* Effect.promise(() => request.json())).toMatchObject({
                model: "gemini-3.8-flash",
                input: [{ type: "user_input", content: [{ type: "text", text: "Say hello." }] }],
                system_instruction: "Be concise.",
                stream: true,
                store: false,
                service_tier: "flex",
                generation_config: { thinking_level: "low" },
              })
              return input.respond(
                sseEvents(
                  { event_type: "interaction.created", interaction: { id: "interaction_1" } },
                  { event_type: "interaction.status_update", interaction_id: "interaction_1", status: "in_progress" },
                  { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } },
                  { event_type: "step.delta", index: 0, delta: { type: "text", text: "Hello." } },
                  { event_type: "step.stop", index: 0 },
                  {
                    event_type: "interaction.completed",
                    interaction: {
                      id: "interaction_1",
                      status: "completed",
                      usage: { total_input_tokens: 10, total_cached_tokens: 4, total_output_tokens: 2 },
                    },
                  },
                ) + "event: done\ndata: {}\n\n",
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello.")
      expect(response.usage?.cacheReadInputTokens).toBe(4)
      expect(response.usage?.providerMetadata).toEqual({
        vertex: { total_input_tokens: 10, total_cached_tokens: 4, total_output_tokens: 2 },
      })
      expect(response.events.at(-1)?.providerMetadata).toEqual({ vertex: { interactionId: "interaction_1" } })
    }),
  )

  it.effect("uses the project-free Express endpoint with API-key auth", () =>
    Effect.gen(function* () {
      yield* LLMClient.generate(
        LLM.request({
          model: GoogleVertexInteractions.configure({ apiKey: "vertex-key" }).model("gemini-3.8-flash"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              expect(input.request.url).toBe(
                "https://aiplatform.googleapis.com/v1beta1/locations/global/interactions?alt=sse",
              )
              expect(input.request.headers["x-goog-api-key"]).toBe("vertex-key")
              expect(input.request.headers).not.toHaveProperty("authorization")
              expect(input.request.headers).not.toHaveProperty("x-vertex-ai-llm-shared-request-type")
              return input.respond(
                sseEvents({ event_type: "interaction.completed", interaction: { status: "completed" } }),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
    }),
  )

  it.effect("resolves an auth override on every request and honors a custom base URL without a project", () =>
    Effect.gen(function* () {
      const tokens = ["first-token", "refreshed-token"]
      const model = GoogleVertexInteractions.configure({
        baseURL: "https://vertex.test/v1beta1/locations/global",
        auth: Auth.effect(Effect.sync(() => Redacted.make(tokens.shift() ?? "unexpected-token"))).bearer(),
      }).model("gemini-3.8-flash")
      const headers: string[] = []
      yield* Effect.forEach(["First.", "Second."], (prompt) => LLMClient.generate(LLM.request({ model, prompt }))).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              expect(input.request.url).toBe("https://vertex.test/v1beta1/locations/global/interactions?alt=sse")
              headers.push(input.request.headers.authorization)
              return input.respond(
                sseEvents({ event_type: "interaction.completed", interaction: { status: "completed" } }),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
      expect(headers).toEqual(["Bearer first-token", "Bearer refreshed-token"])
    }),
  )

  test("uses the jurisdictional host and lazily configures ADC", () => {
    const model = GoogleVertexInteractions.configure({ project: "vertex-project", location: "eu" }).model(
      "gemini-3.8-flash",
    )
    expect(model.route.endpoint.baseURL).toBe(
      "https://aiplatform.eu.rep.googleapis.com/v1beta1/projects/vertex-project/locations/eu",
    )
    expect(model.provider).toBe("google-vertex")
    expect(model.route.protocol).toBe("google-interactions")
  })

  test("rejects conflicting credentials", () => {
    expect(() =>
      // @ts-expect-error Exercise invalid credentials from untyped callers.
      GoogleVertexInteractions.configure({ apiKey: "key", accessToken: "token" }),
    ).toThrow("Google Vertex apiKey cannot be combined with accessToken or auth")
    expect(() =>
      // @ts-expect-error Exercise invalid credentials from untyped callers.
      GoogleVertexInteractions.configure({ apiKey: "key", auth: Auth.bearer("token") }),
    ).toThrow("Google Vertex apiKey cannot be combined with accessToken or auth")
    expect(() =>
      // @ts-expect-error Exercise invalid credentials from untyped callers.
      GoogleVertexInteractions.model("gemini-3.8-flash", { apiKey: "key", accessToken: "token" }),
    ).toThrow("Google Vertex apiKey cannot be combined with accessToken or auth")
  })

  test("requires a project unless a custom base URL or API key is provided", () => {
    expect(() => GoogleVertexInteractions.configure({ project: "", accessToken: "token" })).toThrow(
      "Google Vertex requires a project when baseURL is not configured",
    )
  })

  it.effect("round-trips tool signatures under Vertex metadata without enabling storage", () =>
    Effect.gen(function* () {
      const model = GoogleVertexInteractions.configure({
        accessToken: "vertex-token",
        project: "vertex-project",
      }).model("gemini-3.8-flash")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Check the weather." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                event_type: "step.start",
                index: 0,
                step: { type: "function_call", id: "call_1", name: "lookup", arguments: { city: "Paris" } },
              },
              { event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "tool_sig" } },
              { event_type: "step.stop", index: 0 },
              { event_type: "interaction.completed", interaction: { id: "interaction_1", status: "requires_action" } },
            ),
          ),
        ),
      )
      const call = response.toolCalls[0]
      expect(call.providerMetadata).toEqual({ vertex: { interactionSignature: "tool_sig" } })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([ToolCallPart.make(call)]),
            Message.tool({ id: call.id, name: call.name, result: { weather: "sunny" } }),
          ],
        }),
      )
      expect(prepared.body).toMatchObject({
        store: false,
        input: [
          { type: "function_call", id: "call_1", name: "lookup", arguments: { city: "Paris" }, signature: "tool_sig" },
          { type: "function_result", call_id: "call_1", name: "lookup", result: { weather: "sunny" } },
        ],
      })
      expect(prepared.body.previous_interaction_id).toBeUndefined()
    }),
  )
})
