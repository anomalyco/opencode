import { expect } from "bun:test"
import { ai, LLMEvent } from "@opencode/ai/effect"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { DSML_GUARD_MESSAGE, EMPTY_VETTING_LOOP_MESSAGE } from "@opencode/core/session/llm/dsml"
import { DSMLGuard } from "@opencode/core/session/llm/dsml-guard"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { testEffect } from "../lib/effect"

// The closing marker a parsed invocation never leaves in assistant text.
const CLOSING = "</" + "\uFF5CDSML\uFF5C" + "invoke>"

const chunk = (content: string) => ({
  id: "completion",
  object: "chat.completion.chunk",
  created: 1,
  model: "dsv4",
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
})

const stop = {
  id: "completion",
  object: "chat.completion.chunk",
  created: 1,
  model: "dsv4",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
}

const sse = (chunks: readonly unknown[]) =>
  new Response(chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  })

const model = (id: string) =>
  OpenAIChat.route.with({ provider: "llmgw", endpoint: { baseURL: "https://llmgw.test/v1" } }).model({ id })

// Mirrors the production seam in `effect/app-node-platform.ts`: the guard wraps
// the real client, so a provider rewritten to the native route is still covered.
const guarded = (response: Response) => {
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response))),
  )
  const executor = RequestExecutor.layer.pipe(Layer.provide(http))
  return DSMLGuard.layer.pipe(Layer.provide(LLMClient.layer.pipe(Layer.provide(executor))))
}

const collect = (id: string, response: Response) =>
  Effect.gen(function* () {
    const client = yield* LLMClient.Service
    return yield* client.stream(ai.request({ model: model(id), prompt: "hi" })).pipe(Stream.runCollect)
  }).pipe(Effect.provide(guarded(response)))

// The production node graph, not a hand-built layer: this fails if the guard is
// dropped from `effect/app-node-platform.ts`.
const production = (response: Response) =>
  AppNodeBuilder.build(LayerNode.group([LayerNodePlatform.llmClient]), [
    httpClient.replace(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response))),
      ),
    ),
  ])

const collectProduction = (id: string, response: Response) =>
  Effect.gen(function* () {
    const client = yield* LLMClient.Service
    return yield* client.stream(ai.request({ model: model(id), prompt: "hi" })).pipe(Stream.runCollect)
  }).pipe(Effect.provide(production(response)))

const it = testEffect(Layer.empty)

it.effect("the production llm client guards the native dsv4 route", () =>
  Effect.gen(function* () {
    const events = Array.from(yield* collectProduction("dsv4", sse([chunk(CLOSING), stop])))
    expect(events.find((event) => event.type === "provider-error")).toEqual({
      type: "provider-error",
      message: DSML_GUARD_MESSAGE,
    })
  }),
)

it.effect("stops a native dsv4 response that emits the DSML closing marker", () =>
  Effect.gen(function* () {
    const events = Array.from(yield* collect("dsv4", sse([chunk("before "), chunk(CLOSING), chunk(" after"), stop])))
    const error = events.find((event) => event.type === "provider-error")
    expect(error).toEqual({ type: "provider-error", message: DSML_GUARD_MESSAGE })
    // The marker is the last text the model produced; nothing after it is replayed.
    expect(events.some((event) => event.type === "text-delta" && event.text.includes("after"))).toBe(false)
  }),
)

it.effect("stops a native dsv4 response that repeats empty vetting blocks", () =>
  Effect.gen(function* () {
    const events = Array.from(yield* collect("dsv4", sse([chunk("<vetting></vetting>".repeat(16)), stop])))
    expect(events.find((event) => event.type === "provider-error")).toEqual({
      type: "provider-error",
      message: EMPTY_VETTING_LOOP_MESSAGE,
    })
  }),
)

it.effect("passes ordinary native dsv4 text through untouched", () =>
  Effect.gen(function* () {
    const events = Array.from(yield* collect("dsv4", sse([chunk("hello "), chunk("world"), stop])))
    expect(events.some((event) => event.type === "provider-error")).toBe(false)
    expect(
      events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.text)
        .join(""),
    ).toBe("hello world")
  }),
)

it.effect("leaves other models on the same provider unguarded", () =>
  Effect.gen(function* () {
    const events = Array.from(yield* collect("thinker", sse([chunk(CLOSING), stop])))
    expect(events.some((event) => event.type === "provider-error")).toBe(false)
  }),
)

it.effect("stops pulling from the provider once the guard fires", () =>
  Effect.gen(function* () {
    let pulled = 0
    const upstream = Stream.fromIterable([
      LLMEvent.textDelta({ id: "t", text: CLOSING }),
      ...Array.from({ length: 50 }, () => LLMEvent.textDelta({ id: "t", text: "x" })),
    ]).pipe(Stream.tap(() => Effect.sync(() => void pulled++)))
    const events = Array.from(yield* DSMLGuard.guardDSMLEvents(upstream).pipe(Stream.runCollect))
    expect(events.map((event) => event.type)).toEqual(["text-delta", "provider-error"])
    // The response is already unusable, so the rest of it is not drained.
    expect(pulled).toBeLessThan(5)
  }),
)

it.effect("OPENCODE_DSV4_RECOVERY_ENABLED=0 disables the guard", () =>
  Effect.gen(function* () {
    const previous = process.env.OPENCODE_DSV4_RECOVERY_ENABLED
    process.env.OPENCODE_DSV4_RECOVERY_ENABLED = "0"
    const events = Array.from(
      yield* collect("dsv4", sse([chunk(CLOSING), stop])).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.OPENCODE_DSV4_RECOVERY_ENABLED
            else process.env.OPENCODE_DSV4_RECOVERY_ENABLED = previous
          }),
        ),
      ),
    )
    expect(events.some((event) => event.type === "provider-error")).toBe(false)
  }),
)
