import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { ai, isRetryable, Media, Message, ToolCallPart } from "../../src/effect.js"
import { Google } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/testing.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const model = Google.configure({ apiKey: "test", baseURL: "https://generativelanguage.test/v1beta" }).interactions(
  "gemini-3.8-flash",
)

const generate = (...events: ReadonlyArray<unknown>) =>
  LLMClient.generate(ai.request({ model, prompt: "Hi" })).pipe(Effect.provide(fixedResponse(sseEvents(...events))))

const reply = [
  { event_type: "step.start", index: 0, step: { type: "model_output" } },
  { event_type: "step.delta", index: 0, delta: { type: "text", text: "Hello." } },
  { event_type: "step.stop", index: 0 },
  { event_type: "interaction.completed", interaction: { status: "completed" } },
]

describe("Google Interactions", () => {
  it.effect("sends Gemini safety settings in the Interactions request", () =>
    Effect.gen(function* () {
      const bodies: unknown[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(JSON.parse(input.text))
          return input.respond(sseEvents(...reply), { headers: { "content-type": "text/event-stream" } })
        }),
      )
      const configured = Google.configure({
        apiKey: "test",
        baseURL: "https://generativelanguage.test/v1beta",
        providerOptions: {
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_LOW_AND_ABOVE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          ],
        },
      }).interactions("gemini-3.8-flash")
      yield* LLMClient.generate(ai.request({ model: configured, prompt: "Hi" })).pipe(Effect.provide(layer))

      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toHaveProperty("safety_settings", [
        { type: "harassment", threshold: "block_low_and_above" },
        { type: "hate_speech", threshold: "block_only_high" },
      ])
      expect(bodies[0]).not.toHaveProperty("safetySettings")
    }),
  )

  it.effect("lowers DOCX as a document and rejects an undocumented Office MIME type", () =>
    Effect.gen(function* () {
      const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      const docm = "application/vnd.ms-word.document.macroenabled.12"
      const request = (mime: string) => ai.request({ model, prompt: Message.media(Media.base64("UEsDBA==", mime)) })

      const compiled = yield* compileRequest(request(docx))
      expect(compiled.body.input).toEqual([
        { type: "user_input", content: [{ type: "document", mime_type: docx, data: "UEsDBA==" }] },
      ])

      const error = yield* compileRequest(request(docm)).pipe(Effect.flip)
      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        message: `Google Interactions does not support ${docm} document input`,
      })
    }),
  )

  it.effect("classifies premature EOF before interaction.completed as an incomplete stream", () =>
    Effect.gen(function* () {
      const error = yield* generate(
        { event_type: "interaction.created", interaction: { id: "int_1" } },
        { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "Partial" } },
      ).pipe(Effect.flip)

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        route: "google/google-interactions",
        message: "The provider response ended unexpectedly.",
        classification: "incomplete-stream",
      })
      expect(error.partial?.text).toBe("Partial")
      expect(isRetryable(error)).toBe(true)
    }),
  )

  it.effect("normalizes completed interactions that emitted function_call steps to tool-calls", () =>
    Effect.gen(function* () {
      const withToolCall = yield* generate(
        {
          event_type: "step.start",
          index: 0,
          step: { type: "function_call", id: "call_1", name: "lookup", arguments: { query: "weather" } },
        },
        { event_type: "step.stop", index: 0 },
        { event_type: "interaction.completed", interaction: { id: "int_1", status: "completed" } },
      )
      const textOnly = yield* generate(
        { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "Done." } },
        { event_type: "step.stop", index: 0 },
        { event_type: "interaction.completed", interaction: { id: "int_2", status: "completed" } },
      )

      expect(withToolCall.toolCalls).toMatchObject([{ id: "call_1", name: "lookup", input: { query: "weather" } }])
      expect(withToolCall.finishReason).toEqual({ normalized: "tool-calls", raw: "completed" })
      expect(textOnly.finishReason).toEqual({ normalized: "stop", raw: "completed" })
    }),
  )

  it.effect("fails a completed interaction that has no output as a retryable incomplete stream", () =>
    Effect.gen(function* () {
      // Gemini 4 sends this for a generation it could not parse: one thought step, billed output tokens, no output.
      const completedEvent = {
        event_type: "interaction.completed",
        interaction: {
          status: "completed",
          usage: {
            total_tokens: 325863,
            total_input_tokens: 325163,
            total_cached_tokens: 323114,
            total_output_tokens: 28,
            total_thought_tokens: 672,
          },
        },
      }
      const error = yield* generate(
        { event_type: "interaction.created", interaction: {} },
        { event_type: "interaction.status_update", status: "in_progress" },
        { event_type: "step.start", index: 0, step: { type: "thought" } },
        { event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "sig_1" } },
        { event_type: "step.stop", index: 0 },
        completedEvent,
      ).pipe(Effect.flip)

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        route: "google/google-interactions",
        message: "Gemini completed without output",
        classification: "incomplete-stream",
        body: JSON.stringify(completedEvent),
      })
      expect(isRetryable(error)).toBe(true)

      const blank = yield* generate(
        { event_type: "step.start", index: 0, step: { type: "model_output", content: [{ type: "text", text: "" }] } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "" } },
        { event_type: "step.stop", index: 0 },
        { event_type: "interaction.completed", interaction: { status: "completed" } },
      ).pipe(Effect.flip)
      expect(blank.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
    }),
  )

  it.effect("finishes an interaction that reached its output limit before any output", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        { event_type: "step.start", index: 0, step: { type: "thought", signature: "sig_1" } },
        { event_type: "step.stop", index: 0 },
        { event_type: "interaction.completed", interaction: { status: "incomplete" } },
      )

      expect(response.text).toBe("")
      expect(response.finishReason).toEqual({ normalized: "length", raw: "incomplete" })
    }),
  )

  it.effect("moves generateContent thought signatures onto thought steps", () =>
    Effect.gen(function* () {
      const signed = (thoughtSignature: string) => ({ google: { thoughtSignature } })
      const compiled = yield* compileRequest(
        ai.request({
          model,
          messages: [
            Message.user("Check the weather."),
            Message.assistant([
              { type: "reasoning", text: "Plan the lookups." },
              ToolCallPart.make({
                id: "call_1",
                name: "lookup",
                input: { city: "Paris" },
                providerMetadata: signed("sig_calls"),
              }),
              ToolCallPart.make({ id: "call_2", name: "lookup", input: { city: "Lyon" } }),
            ]),
            Message.tool({ id: "call_1", name: "lookup", result: { weather: "sunny" } }),
            Message.tool({ id: "call_2", name: "lookup", result: { weather: "cloudy" } }),
            Message.assistant([
              ToolCallPart.make({
                id: "call_3",
                name: "lookup",
                input: { city: "Nice" },
                providerMetadata: signed("sig_first"),
              }),
              ToolCallPart.make({
                id: "call_4",
                name: "lookup",
                input: { city: "Lille" },
                providerMetadata: signed("sig_second"),
              }),
            ]),
            Message.tool({ id: "call_3", name: "lookup", result: { weather: "warm" } }),
            Message.tool({ id: "call_4", name: "lookup", result: { weather: "wet" } }),
            Message.assistant([
              { type: "reasoning", text: "Summarize.", providerMetadata: signed("sig_reasoning") },
              { type: "text", text: "Sunny in Paris.", providerMetadata: signed("sig_text") },
            ]),
          ],
        }),
      )

      expect(compiled.body.input).toEqual([
        { type: "user_input", content: [{ type: "text", text: "Check the weather." }] },
        { type: "thought", signature: "sig_calls", summary: [{ type: "text", text: "Plan the lookups." }] },
        { type: "function_call", id: "call_1", name: "lookup", arguments: { city: "Paris" } },
        { type: "function_call", id: "call_2", name: "lookup", arguments: { city: "Lyon" } },
        { type: "function_result", call_id: "call_1", name: "lookup", result: { weather: "sunny" } },
        { type: "function_result", call_id: "call_2", name: "lookup", result: { weather: "cloudy" } },
        { type: "thought", signature: "sig_first" },
        { type: "function_call", id: "call_3", name: "lookup", arguments: { city: "Nice" } },
        { type: "thought", signature: "sig_second" },
        { type: "function_call", id: "call_4", name: "lookup", arguments: { city: "Lille" } },
        { type: "function_result", call_id: "call_3", name: "lookup", result: { weather: "warm" } },
        { type: "function_result", call_id: "call_4", name: "lookup", result: { weather: "wet" } },
        { type: "thought", signature: "sig_reasoning", summary: [{ type: "text", text: "Summarize." }] },
        { type: "thought", signature: "sig_text" },
        { type: "model_output", content: [{ type: "text", text: "Sunny in Paris." }] },
      ])
    }),
  )

  it.effect("replays an Interactions signature where the interaction returned it", () =>
    Effect.gen(function* () {
      const compiled = yield* compileRequest(
        ai.request({
          model,
          messages: [
            Message.assistant([
              { type: "reasoning", text: "", providerMetadata: { google: { interactionSignature: "sig_thought" } } },
              ToolCallPart.make({ id: "call_1", name: "lookup", input: { city: "Paris" } }),
            ]),
            Message.tool({ id: "call_1", name: "lookup", result: { weather: "sunny" } }),
            Message.assistant([
              ToolCallPart.make({
                id: "call_2",
                name: "lookup",
                input: { city: "Lyon" },
                providerMetadata: { google: { interactionSignature: "sig_call", thoughtSignature: "sig_other" } },
              }),
            ]),
            Message.tool({ id: "call_2", name: "lookup", result: { weather: "cloudy" } }),
          ],
        }),
      )

      expect(compiled.body.input).toEqual([
        { type: "thought", signature: "sig_thought" },
        { type: "function_call", id: "call_1", name: "lookup", arguments: { city: "Paris" } },
        { type: "function_result", call_id: "call_1", name: "lookup", result: { weather: "sunny" } },
        { type: "function_call", id: "call_2", name: "lookup", arguments: { city: "Lyon" }, signature: "sig_call" },
        { type: "function_result", call_id: "call_2", name: "lookup", result: { weather: "cloudy" } },
      ])
    }),
  )

  it.effect("marks malformed and unexpected tool-call failures as retryable incomplete streams", () =>
    Effect.gen(function* () {
      const codes = ["malformed_function_call", "malformed_tool_call", "unexpected_tool_call", "malformed_response"]
      for (const code of codes) {
        const completedEvent = {
          event_type: "interaction.completed",
          interaction: { status: "failed", errors: [{ code, message: `Stopped: ${code}` }] },
        }
        const fromCompleted = yield* generate(
          { event_type: "step.start", index: 0, step: { type: "thought", signature: "sig_1" } },
          {
            event_type: "step.delta",
            index: 0,
            delta: { type: "thought_summary", content: { type: "text", text: "Planning tool call" } },
          },
          { event_type: "step.stop", index: 0 },
          completedEvent,
        ).pipe(Effect.flip)

        expect(fromCompleted.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Stopped: ${code}`,
          classification: "incomplete-stream",
          body: JSON.stringify(completedEvent),
        })
        expect(fromCompleted.partial?.reasoning).toBe("Planning tool call")
        expect(isRetryable(fromCompleted)).toBe(true)

        const streamEvent = { event_type: "error", error: { code, message: `Stream error: ${code}` } }
        const fromError = yield* generate(streamEvent).pipe(Effect.flip)
        expect(fromError.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Stream error: ${code}`,
          classification: "incomplete-stream",
          body: JSON.stringify(streamEvent),
        })
        expect(isRetryable(fromError)).toBe(true)
      }
    }),
  )

  it.effect("keeps deterministic tool and image output rejections non-retryable", () =>
    Effect.gen(function* () {
      for (const code of ["missing_thought_signature", "too_many_tool_calls", "no_image"]) {
        const completedEvent = {
          event_type: "interaction.completed",
          interaction: { status: "failed", errors: [{ code, message: `Rejected: ${code}` }] },
        }
        const fromCompleted = yield* generate(completedEvent).pipe(Effect.flip)
        expect(fromCompleted.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Rejected: ${code}`,
          body: JSON.stringify(completedEvent),
        })
        if (fromCompleted.reason._tag === "InvalidProviderOutput")
          expect(fromCompleted.reason.classification).toBeUndefined()
        expect(isRetryable(fromCompleted)).toBe(false)

        const streamEvent = { event_type: "error", error: { code, message: `Stream rejected: ${code}` } }
        const fromError = yield* generate(streamEvent).pipe(Effect.flip)
        expect(fromError.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Stream rejected: ${code}`,
          body: JSON.stringify(streamEvent),
        })
        if (fromError.reason._tag === "InvalidProviderOutput") expect(fromError.reason.classification).toBeUndefined()
        expect(isRetryable(fromError)).toBe(false)
      }
    }),
  )

  it.effect("classifies plain-string stream error payloads by their message", () =>
    Effect.gen(function* () {
      const rateLimited = { event_type: "error", error: "Rate limit exceeded, too many requests" }
      const rateLimitError = yield* generate(rateLimited).pipe(Effect.flip)
      expect(rateLimitError.reason).toMatchObject({
        _tag: "RateLimit",
        message: "Rate limit exceeded, too many requests",
        body: JSON.stringify(rateLimited),
      })

      const overflow = { event_type: "error", error: "prompt is too long" }
      const overflowError = yield* generate(overflow).pipe(Effect.flip)
      expect(overflowError.reason).toMatchObject({
        _tag: "InvalidRequest",
        message: "prompt is too long",
        classification: "context-overflow",
        body: JSON.stringify(overflow),
      })

      const bare = yield* generate({ event_type: "error" }).pipe(Effect.flip)
      expect(bare.reason).toMatchObject({ _tag: "UnknownProvider", message: "Google Interactions stream error" })
    }),
  )

  it.effect("classifies blocked Interactions generations as non-retryable content policy errors", () =>
    Effect.gen(function* () {
      const codes = [
        "safety",
        "recitation",
        "prohibited_content",
        "spii",
        "blocklist",
        "image_safety",
        "image_prohibited_content",
        "image_recitation",
        "content_blocked",
      ]
      for (const code of codes) {
        const completedEvent = {
          event_type: "interaction.completed",
          interaction: { status: "failed", errors: [{ code, message: `Blocked: ${code}` }] },
        }
        const fromCompleted = yield* generate(completedEvent).pipe(Effect.flip)
        expect(fromCompleted.reason).toMatchObject({
          _tag: "ContentPolicy",
          message: `Blocked: ${code}`,
          body: JSON.stringify(completedEvent),
        })
        expect(isRetryable(fromCompleted)).toBe(false)

        const streamEvent = { event_type: "error", error: { code, message: `Stream blocked: ${code}` } }
        const fromError = yield* generate(streamEvent).pipe(Effect.flip)
        expect(fromError.reason).toMatchObject({
          _tag: "ContentPolicy",
          message: `Stream blocked: ${code}`,
          body: JSON.stringify(streamEvent),
        })
        expect(isRetryable(fromError)).toBe(false)
      }
    }),
  )
})

describe("Google Interactions response continuation", () => {
  const request = ai.request({
    model,
    prompt: "Count.",
    maxTokens: 66000,
    tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
  })
  const scripted = (...responses: ReadonlyArray<string | ReadableStream<Uint8Array> | Response>) => {
    const bodies: Array<Record<string, unknown>> = []
    const layer = dynamicResponse((input) =>
      Effect.sync(() => {
        const response = responses[Math.min(bodies.length, responses.length - 1)]
        bodies.push(JSON.parse(input.text))
        if (response instanceof Response) return input.respond(response.body, response)
        return input.respond(response, { headers: { "content-type": "text/event-stream" } })
      }),
    )
    return { bodies, layer }
  }
  const startText = (index: number) => ({ event_type: "step.start", index, step: { type: "model_output" } })
  const text = (index: number, value: string) => ({
    event_type: "step.delta",
    index,
    delta: { type: "text", text: value },
  })
  const checkpoint = (token: string, usage?: Record<string, number>) => ({
    event_type: "interaction.status_update",
    status: "in_progress",
    continuation_token: token,
    usage,
  })
  const completed = (interaction: Record<string, unknown> = {}) => ({
    event_type: "interaction.completed",
    interaction: { status: "completed", ...interaction },
  })

  const continueWith = (token: string) =>
    sseEvents(completed({ status: "requires_continuation", continuation_token: token }))

  const disconnect = (frames: string, message: string) => {
    let sent = false
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return controller.error(new Error(message))
        sent = true
        controller.enqueue(new TextEncoder().encode(frames))
      },
    })
  }

  it.effect("joins two hops into one response with signatures, tool calls, and combined usage", () =>
    Effect.gen(function* () {
      const server = scripted(
        sseEvents(
          {
            event_type: "step.start",
            index: 0,
            step: { type: "thought", summary: [{ type: "text", text: "Plan." }], signature: "signed-thought" },
          },
          { event_type: "step.stop", index: 0 },
          startText(1),
          text(1, "One"),
          checkpoint("older-checkpoint", { total_input_tokens: 7, total_output_tokens: 1 }),
          text(1, ", two"),
          completed({
            status: "requires_continuation",
            continuation_token: "next-hop",
            usage: {
              total_input_tokens: 10,
              total_cached_tokens: 3,
              total_output_tokens: 3,
              total_thought_tokens: 4,
              total_tokens: 17,
            },
          }),
        ),
        sseEvents(
          startText(1),
          text(1, ", three."),
          { event_type: "step.stop", index: 1 },
          {
            event_type: "step.start",
            index: 2,
            step: { type: "function_call", id: "call_1", name: "lookup", arguments: { count: 3 } },
          },
          {
            event_type: "step.delta",
            index: 2,
            delta: { type: "thought_signature", signature: "signed-tool" },
          },
          { event_type: "step.stop", index: 2 },
          completed({
            id: "final-hop",
            usage: {
              total_input_tokens: 17,
              total_cached_tokens: 10,
              total_output_tokens: 4,
              total_thought_tokens: 2,
              total_tokens: 23,
            },
          }),
        ),
      )
      const result = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer))

      expect(server.bodies).toHaveLength(2)
      expect(server.bodies[0]).toMatchObject({ store: false, generation_config: { max_output_tokens: 66000 } })
      expect(server.bodies[1]).toEqual({ ...server.bodies[0], continuation_token: "next-hop" })
      expect(result.text).toBe("One, two, three.")
      expect(result.reasoning).toBe("Plan.")
      expect(result.events.find((event) => event.type === "reasoning-end")).toMatchObject({
        providerMetadata: { google: { interactionSignature: "signed-thought" } },
      })
      expect(result.toolCalls).toMatchObject([
        {
          id: "call_1",
          input: { count: 3 },
          providerMetadata: { google: { interactionSignature: "signed-tool" } },
        },
      ])
      expect(result.events.filter((event) => event.type === "finish")).toHaveLength(1)
      expect(result.events.filter((event) => event.type === "step-start")).toHaveLength(1)
      expect(result.finishReason).toEqual({ normalized: "tool-calls", raw: "completed" })
      expect(result.events.find((event) => event.type === "finish")).toMatchObject({
        providerMetadata: { google: { interactionId: "final-hop" } },
      })
      expect(result.usage).toMatchObject({
        inputTokens: 10,
        nonCachedInputTokens: 7,
        cacheReadInputTokens: 3,
        outputTokens: 13,
        reasoningTokens: 6,
        totalTokens: 23,
        providerMetadata: {
          google: {
            total_input_tokens: 27,
            total_cached_tokens: 13,
            total_output_tokens: 7,
            total_thought_tokens: 6,
            total_tokens: 40,
            requests: 2,
          },
        },
      })
    }),
  )

  it.effect("resumes a broken connection at a checkpoint with no later output", () =>
    Effect.gen(function* () {
      const frames = sseEvents(
        startText(0),
        text(0, "One"),
        checkpoint("resume", { total_input_tokens: 10, total_output_tokens: 1 }),
        { event_type: "step.stop", index: 0 },
      )
      const server = scripted(
        disconnect(frames, "connection reset"),
        sseEvents(
          startText(0),
          text(0, ", two."),
          completed({ usage: { total_input_tokens: 11, total_output_tokens: 2 } }),
        ),
      )
      const result = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer))

      expect(server.bodies).toHaveLength(2)
      expect(server.bodies[1]).toEqual({ ...server.bodies[0], continuation_token: "resume" })
      expect(result.text).toBe("One, two.")
      expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 3 })
    }),
  )

  it.effect("does not replay visible output emitted after a checkpoint", () =>
    Effect.gen(function* () {
      const server = scripted(
        sseEvents(startText(0), text(0, "One"), checkpoint("stale"), text(0, ", two"), checkpoint("stale")),
      )
      const error = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer), Effect.flip)

      expect(server.bodies).toHaveLength(1)
      expect(error.partial?.text).toBe("One, two")
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
      expect(isRetryable(error)).toBe(true)
    }),
  )

  it.effect("does not resume a tool call whose arguments or completion can be replayed", () =>
    Effect.gen(function* () {
      const server = scripted(
        sseEvents(
          {
            event_type: "step.start",
            index: 0,
            step: { type: "function_call", id: "call_1", name: "lookup", arguments: {} },
          },
          checkpoint("stale"),
          { event_type: "step.delta", index: 0, delta: { type: "arguments_delta", arguments: "{}" } },
        ),
      )
      const error = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer), Effect.flip)

      expect(server.bodies).toHaveLength(1)
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
    }),
  )

  it.effect("continues from a status update owned by a stored interaction", () =>
    Effect.gen(function* () {
      const server = scripted(
        sseEvents(
          { ...checkpoint("stored-token"), interaction_id: "hop-owner", status: "requires_continuation" },
          completed({ status: "requires_continuation" }),
        ),
        sseEvents(startText(0), text(0, "Done."), completed()),
      )
      yield* LLMClient.generate({ ...request, providerOptions: { store: true } }).pipe(Effect.provide(server.layer))

      expect(server.bodies).toHaveLength(2)
      expect(server.bodies[1]).not.toHaveProperty("input")
      expect(server.bodies[1]).toMatchObject({
        store: true,
        continuation_token: "stored-token",
        previous_interaction_id: "hop-owner",
      })
    }),
  )

  it.effect("cancels a continued response without reconnecting from its checkpoint", () =>
    Effect.gen(function* () {
      const checkpointRead = yield* Deferred.make<void>()
      const server = scripted(
        sseEvents(completed({ status: "requires_continuation", continuation_token: "next-hop" })),
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvents(checkpoint("resume"))))
          },
        }),
      )
      const fiber = yield* LLMClient.stream({ ...request, includeRaw: true }).pipe(
        Stream.tap((event) =>
          event.type === "raw" && JSON.stringify(event.data).includes('"continuation_token":"resume"')
            ? Deferred.succeed(checkpointRead, undefined)
            : Effect.void,
        ),
        Stream.runDrain,
        Effect.provide(server.layer),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(checkpointRead)
      yield* Fiber.interrupt(fiber)

      expect(server.bodies).toHaveLength(2)
    }),
  )

  it.effect("stops when a completed hop returns its own start token", () =>
    Effect.gen(function* () {
      const server = scripted(continueWith("repeat"), continueWith("repeat"), sseEvents(completed()))
      const error = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer), Effect.flip)

      expect(server.bodies.map((body) => body.continuation_token)).toEqual([undefined, "repeat"])
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
    }),
  )

  it.effect("reconnects three times without progress and surfaces the last disconnect", () =>
    Effect.gen(function* () {
      const empty = sseEvents()
      const server = scripted(
        continueWith("repeat"),
        disconnect(empty, "first connection reset"),
        empty,
        disconnect(empty, "last connection reset"),
        empty,
        sseEvents(completed()),
      )
      const error = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer), Effect.flip)

      expect(server.bodies.map((body) => body.continuation_token)).toEqual([
        undefined,
        "repeat",
        "repeat",
        "repeat",
        "repeat",
      ])
      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        classification: "incomplete-stream",
        message: expect.stringContaining("last connection reset"),
      })
      expect(isRetryable(error)).toBe(true)
    }),
  )

  it.effect("resets the reconnect budget after a new checkpoint", () =>
    Effect.gen(function* () {
      const empty = sseEvents()
      const server = scripted(
        continueWith("first"),
        empty,
        empty,
        empty,
        sseEvents(checkpoint("new")),
        empty,
        empty,
        empty,
        sseEvents(startText(0), text(0, "Done."), completed()),
      )
      const result = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer))

      expect(server.bodies.map((body) => body.continuation_token)).toEqual([
        undefined,
        "first",
        "first",
        "first",
        "first",
        "new",
        "new",
        "new",
        "new",
      ])
      expect(result.finishReason.normalized).toBe("stop")
    }),
  )

  it.effect("does not resume when a continuation request gets an HTTP error", () =>
    Effect.gen(function* () {
      const server = scripted(
        continueWith("next-hop"),
        Response.json({ error: { message: "Too many requests" } }, { status: 429 }),
        sseEvents(completed()),
      )
      const error = yield* LLMClient.generate(request).pipe(Effect.provide(server.layer), Effect.flip)

      expect(server.bodies.map((body) => body.continuation_token)).toEqual([undefined, "next-hop"])
      expect(error.reason).toMatchObject({ _tag: "RateLimit", http: { status: 429 } })
      expect(isRetryable(error)).toBe(true)
    }),
  )
})
