import { describe, expect } from "bun:test"
import { Effect, Exit, Option, Schema, Stream } from "effect"
import { LLM } from "../src/index.js"
import { Endpoint, LLMClient, Protocol, Route, type FramingDef } from "../src/route.js"
import * as ProviderShared from "../src/protocols/shared.js"
import { AIError, InvalidProviderOutputError, LanguageModel, LLMEvent } from "../src/schema/index.js"
import { testEffect } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

const FakeEvent = Schema.Struct({
  type: Schema.Literals([
    "text",
    "finish",
    "finish-then-text",
    "provider-error",
    "fail",
    "die",
    "throw",
    "stop",
    "empty",
  ]),
  text: Schema.optional(Schema.String),
})
type FakeEvent = Schema.Schema.Type<typeof FakeEvent>

// The response body is a JSON array of frames, emitted as one batch so each case exercises a multi-frame chunk.
const framing: FramingDef<string> = {
  id: "fake-frames",
  frame: (bytes) =>
    Stream.unwrap(
      bytes.pipe(
        Stream.decodeText(),
        Stream.mkString,
        Effect.map((text) => {
          const frames: ReadonlyArray<string> = JSON.parse(text)
          const failAt = frames.indexOf("fail-framing")
          if (failAt === -1) return Stream.fromArray(frames)
          return Stream.fromArray(frames.slice(0, failAt)).pipe(
            Stream.concat(
              Stream.fail(
                new AIError({ reason: new InvalidProviderOutputError({ route: "fake", message: "framing failed" }) }),
              ),
            ),
          )
        }),
      ),
    ),
}

const step = (count: number, event: FakeEvent) => {
  const next = count + 1
  if (event.type === "text")
    return Effect.succeed([next, [LLMEvent.textDelta({ id: "t", text: event.text ?? "" })]] as const)
  if (event.type === "finish" || event.type === "stop")
    return Effect.succeed([next, [LLMEvent.finish({ reason: { normalized: "stop" } })]] as const)
  if (event.type === "finish-then-text")
    return Effect.succeed([
      next,
      [LLMEvent.finish({ reason: { normalized: "stop" } }), LLMEvent.textDelta({ id: "t", text: "late" })],
    ] as const)
  if (event.type === "provider-error")
    return Effect.succeed([next, [LLMEvent.providerError({ message: "overloaded" })]] as const)
  if (event.type === "fail") return Effect.fail(ProviderShared.eventError("fake", "step failed", "step-body"))
  if (event.type === "die") return Effect.die(new Error("step died"))
  if (event.type === "throw") throw new Error("step threw")
  return Effect.succeed([next, []] as const)
}

const protocol = (options: { readonly terminal?: boolean; readonly onHalt?: ReadonlyArray<LLMEvent> | "count" }) =>
  Protocol.make<{ readonly body: string }, string, FakeEvent, number>({
    id: "fake-stream",
    body: {
      schema: Schema.Struct({ body: Schema.String }),
      from: (request) =>
        Effect.succeed({
          body: request.messages
            .flatMap((message) => message.content)
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join(""),
        }),
    },
    stream: {
      event: Schema.fromJsonString(FakeEvent),
      initial: () => 0,
      step,
      terminal: options.terminal ? (event) => event.type === "stop" : undefined,
      onHalt:
        options.onHalt === undefined
          ? undefined
          : (count) =>
              Effect.succeed(
                options.onHalt === "count"
                  ? [
                      LLMEvent.textDelta({ id: "t", text: `halt:${count}` }),
                      LLMEvent.finish({ reason: { normalized: "stop" } }),
                    ]
                  : (options.onHalt ?? []),
              ),
    },
  })

const request = (frames: ReadonlyArray<unknown>, options: Parameters<typeof protocol>[0] = {}) =>
  LLM.request({
    id: "req_1",
    model: LanguageModel.make({
      id: "fake-model",
      provider: "fake-provider",
      route: Route.make({
        id: "stream-fake",
        protocol: protocol(options),
        endpoint: Endpoint.path("/chat", { baseURL: "https://fake.local" }),
        framing,
      }),
    }),
    prompt: JSON.stringify(frames.map((frame) => (typeof frame === "string" ? frame : JSON.stringify(frame)))),
  })

const run = (frames: ReadonlyArray<unknown>, options: Parameters<typeof protocol>[0] = {}) =>
  Effect.gen(function* () {
    const seen: LLMEvent[] = []
    const exit = yield* (yield* LLMClient.Service).stream(request(frames, options)).pipe(
      Stream.runForEach((event) => Effect.sync(() => seen.push(event))),
      Effect.exit,
    )
    return {
      seen: seen.map((event) => (event.type === "text-delta" ? `text:${event.text}` : event.type)),
      error: Option.getOrUndefined(Exit.findErrorOption(exit)),
    }
  })

const it = testEffect(dynamicResponse(({ text, respond }) => Effect.succeed(respond(JSON.parse(text).body))))

const text = (value: string) => ({ type: "text", text: value })

describe("route stream pipeline", () => {
  it.effect("emits every event from a multi-frame batch in order", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "empty" }, text("b"), { type: "finish" }])
      expect(result).toEqual({ seen: ["text:a", "text:b", "finish"], error: undefined })
    }),
  )

  it.effect("emits events before a decode failure in the same batch, then fails with the frame body", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), JSON.stringify({ type: "bogus" }), text("b"), { type: "finish" }])
      expect(result.seen).toEqual(["text:a"])
      expect(result.error?.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        route: "stream-fake",
        message: "Invalid fake-provider/stream-fake stream event",
        body: JSON.stringify({ type: "bogus" }),
      })
    }),
  )

  it.effect("does not surface a later failure when the consumer stops first", () =>
    Effect.gen(function* () {
      const events = yield* (yield* LLMClient.Service)
        .stream(request([text("a"), "not json"]))
        .pipe(Stream.take(1), Stream.runCollect)
      expect(events.map((event) => event.type)).toEqual(["text-delta"])
    }),
  )

  it.effect("fails on a frame that is not valid JSON", () =>
    Effect.gen(function* () {
      const result = yield* run(["not json", { type: "finish" }])
      expect(result.seen).toEqual([])
      expect(result.error?.reason).toMatchObject({
        message: "Invalid fake-provider/stream-fake stream event",
        body: "not json",
      })
    }),
  )

  it.effect("keeps step failures and fills a missing body from the frame", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "fail" }, { type: "finish" }])
      expect(result.seen).toEqual(["text:a"])
      expect(result.error?.reason).toMatchObject({ route: "fake", message: "step failed", body: "step-body" })
    }),
  )

  it.effect("wraps step defects as parse failures with the frame body", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "die" }, { type: "finish" }])
      expect(result.seen).toEqual(["text:a"])
      expect(result.error?.reason).toMatchObject({
        route: "fake-provider/stream-fake",
        message: "Failed to parse fake-provider/stream-fake event",
        body: JSON.stringify({ type: "die" }),
      })
    }),
  )

  it.effect("wraps synchronous step throws as stream read failures", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "throw" }, { type: "finish" }])
      expect(result.seen).toEqual(["text:a"])
      expect(result.error?.reason).toMatchObject({
        route: "fake-provider/stream-fake",
        message: "Failed to read fake-provider/stream-fake stream",
      })
      expect(result.error?.reason.body).toBeUndefined()
    }),
  )

  it.effect("passes framing failures through after earlier events", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), "fail-framing"])
      expect(result.seen).toEqual(["text:a"])
      expect(result.error?.reason).toMatchObject({ route: "fake", message: "framing failed" })
    }),
  )

  it.effect("fails when an event follows the terminal event in a later frame", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "finish" }, text("b")])
      expect(result.seen).toEqual(["text:a", "finish"])
      expect(result.error?.reason).toMatchObject({
        route: "fake-provider/stream-fake",
        message: "Provider emitted text-delta after the terminal event",
      })
    }),
  )

  it.effect("fails when an event follows the terminal event in the same step output", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "finish-then-text" }])
      expect(result.seen).toEqual(["text:a", "finish"])
      expect(result.error?.reason).toMatchObject({
        message: "Provider emitted text-delta after the terminal event",
      })
    }),
  )

  it.effect("treats a provider error event as terminal", () =>
    Effect.gen(function* () {
      const ok = yield* run([text("a"), { type: "provider-error" }])
      expect(ok).toEqual({ seen: ["text:a", "provider-error"], error: undefined })
      const late = yield* run([{ type: "provider-error" }, { type: "finish" }])
      expect(late.seen).toEqual(["provider-error"])
      expect(late.error?.reason).toMatchObject({ message: "Provider emitted finish after the terminal event" })
    }),
  )

  it.effect("fails with an incomplete stream error when no terminal event arrives", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), text("b")])
      expect(result.seen).toEqual(["text:a", "text:b"])
      expect(result.error?.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        classification: "incomplete-stream",
        message: "The provider response ended unexpectedly.",
      })
    }),
  )

  it.effect("stops decoding frames after the protocol terminal event", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "stop" }, "not json", { type: "die" }], { terminal: true })
      expect(result).toEqual({ seen: ["text:a", "finish"], error: undefined })
    }),
  )

  it.effect("appends onHalt events using the final parser state", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "empty" }, text("b")], { onHalt: "count" })
      expect(result).toEqual({ seen: ["text:a", "text:b", "text:halt:3", "finish"], error: undefined })
    }),
  )

  it.effect("checks onHalt events against the terminal event", () =>
    Effect.gen(function* () {
      const result = yield* run([text("a"), { type: "finish" }], {
        onHalt: [LLMEvent.textDelta({ id: "t", text: "flush" })],
      })
      expect(result.seen).toEqual(["text:a", "finish"])
      expect(result.error?.reason).toMatchObject({
        message: "Provider emitted text-delta after the terminal event",
      })
    }),
  )
})
