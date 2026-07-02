import { expect } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Deferred, Effect, Latch, Layer, Option, Schema, Stream } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import type { OpenCodeEvent } from "../src"

Flag.OPENCODE_DB = ":memory:"

const it = testEffect(Layer.empty)
type Sdk = typeof import("../src")
type Fixture = { readonly directory: string; readonly sdk: Sdk }

const withEmbedded = <A, E, R>(prefix: string, f: (fixture: Fixture) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(prefix)),
    (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((directory) =>
      Effect.promise(() => import("../src")).pipe(Effect.flatMap((sdk) => f({ directory: directory.path, sdk }))),
    ),
  )

const sessionID = (fixture: Fixture) => fixture.sdk.Session.ID.create()

const location = (fixture: Fixture) =>
  fixture.sdk.Location.Ref.make({ directory: fixture.sdk.AbsolutePath.make(fixture.directory) })

it.live(
  "embedded client uses the real router and handlers",
  () =>
    withEmbedded("opencode-embedded-", (fixture) =>
      Effect.gen(function* () {
        const opencode = yield* fixture.sdk.OpenCode.create()
        const id = sessionID(fixture)
        const model = fixture.sdk.Model.Ref.make({
          id: fixture.sdk.Model.ID.make("embedded"),
          providerID: fixture.sdk.Provider.ID.make("test"),
        })

        yield* opencode.plugin({
          id: `embedded-tools-${crypto.randomUUID()}`,
          effect: (ctx) =>
            ctx.tool
              .register({
                embedded_tool: fixture.sdk.Tool.make({
                  description: "Embedded test tool",
                  input: Schema.Struct({}),
                  output: Schema.Struct({ ok: Schema.Boolean }),
                  execute: () => Effect.succeed({ ok: true }),
                }),
              })
              .pipe(Effect.orDie),
        })

        const created = yield* opencode.sessions.create({
          id,
          agent: fixture.sdk.Agent.ID.make("build"),
          location: location(fixture),
        })
        yield* opencode.sessions.switchModel({ sessionID: id, model })
        const selected = yield* opencode.sessions.get({ sessionID: id })
        const page = yield* opencode.sessions.list({ directory: fixture.sdk.AbsolutePath.make(fixture.directory) })
        const active = yield* opencode.sessions.active()
        const admitted = yield* opencode.sessions.prompt({
          sessionID: id,
          prompt: fixture.sdk.Prompt.make({ text: "Do not run" }),
          resume: false,
        })
        const context = yield* opencode.sessions.context({ sessionID: id })
        yield* opencode.sessions.putContextEntry({ sessionID: id, key: "deploy-target", value: "production" })
        yield* opencode.sessions.putContextEntry({ sessionID: id, key: "flags", value: { beta: true } })
        const contextEntries = yield* opencode.sessions.listContextEntries({ sessionID: id })
        yield* opencode.sessions.removeContextEntry({ sessionID: id, key: "flags" })
        const remainingContextEntries = yield* opencode.sessions.listContextEntries({ sessionID: id })
        const wake = yield* opencode.sessions.prompt({
          sessionID: id,
          prompt: fixture.sdk.Prompt.make({ text: "Promote this input" }),
        })
        const prompted = yield* opencode.sessions.log({ sessionID: id, follow: true }).pipe(
          Stream.filter((event) => event.type === "session.next.prompted" && event.data.messageID === wake.id),
          Stream.runHead,
          Effect.timeout("10 seconds"),
          Effect.map(Option.getOrThrow),
        )
        const wakeContext = yield* opencode.sessions.context({ sessionID: id })
        const event = yield* opencode.sessions.log({ sessionID: id }).pipe(
          Stream.filter((item) => item.type !== "log.synced"),
          Stream.take(1),
          Stream.runHead,
          Effect.map(Option.getOrUndefined),
        )
        const modelMessage = Option.fromNullishOr(context.find((message) => message.type === "model-switched")).pipe(
          Option.getOrThrow,
        )
        const message = yield* opencode.sessions.message({ sessionID: id, messageID: modelMessage.id })
        yield* opencode.sessions.interrupt({ sessionID: id })
        const other = yield* opencode.sessions.create({ location: location(fixture) })
        const missingSessionID = fixture.sdk.Session.ID.create()
        const missing = yield* Effect.all(
          [
            opencode.sessions.log({ sessionID: missingSessionID }).pipe(Stream.runHead, Effect.flip),
            opencode.sessions.interrupt({ sessionID: missingSessionID }).pipe(Effect.flip),
            opencode.sessions.message({ sessionID: missingSessionID, messageID: modelMessage.id }).pipe(Effect.flip),
            opencode.sessions.listContextEntries({ sessionID: missingSessionID }).pipe(Effect.flip),
          ],
          { concurrency: "unbounded" },
        )
        const missingMessage = yield* Effect.flip(
          opencode.sessions.message({
            sessionID: other.id,
            messageID: modelMessage.id,
          }),
        )

        expect(created.id).toBe(id)
        expect(selected.model?.id).toBe(model.id)
        expect(selected.model?.providerID).toBe(model.providerID)
        expect(page.data.some((session) => session.id === id)).toBe(true)
        expect(active).toEqual({ data: {}, watermarks: {} })
        expect(admitted.sessionID).toBe(id)
        expect(prompted.type).toBe("session.next.prompted")
        expect(wakeContext).toContainEqual(expect.objectContaining({ id: wake.id, type: "user" }))
        expect(contextEntries).toEqual([
          { key: "deploy-target", value: "production" },
          { key: "flags", value: { beta: true } },
        ])
        expect(remainingContextEntries).toEqual([{ key: "deploy-target", value: "production" }])
        expect(context.some((message) => message.type === "model-switched")).toBe(true)
        expect(event).toMatchObject({ type: "session.next.model.switched", durable: { seq: 1 } })
        expect(message).toEqual(modelMessage)
        expect(missing.map((error) => error._tag)).toEqual([
          "SessionNotFoundError",
          "SessionNotFoundError",
          "SessionNotFoundError",
          "SessionNotFoundError",
        ])
        expect(missingMessage._tag).toBe("MessageNotFoundError")
      }),
    ),
  10_000,
)

it.live(
  "Location-owned runner events reach the ready global client",
  () =>
    withEmbedded("opencode-embedded-events-", (fixture) =>
      Effect.gen(function* () {
        const opencode = yield* fixture.sdk.OpenCode.create()
        const id = sessionID(fixture)
        const connected = yield* Latch.make(false)
        const prompted = yield* Deferred.make<OpenCodeEvent>()

        yield* opencode.events.subscribe().pipe(
          Stream.runForEach((event) =>
            event.type === "server.connected"
              ? connected.open
              : event.type === "session.next.prompted" && event.data.sessionID === id
                ? Deferred.succeed(prompted, event).pipe(Effect.asVoid)
                : Effect.void,
          ),
          Effect.forkScoped,
        )
        yield* connected.await
        yield* opencode.sessions.create({ id, location: location(fixture) })
        yield* opencode.sessions.prompt({
          sessionID: id,
          prompt: fixture.sdk.Prompt.make({ text: "Observe this input" }),
        })

        const event = yield* Deferred.await(prompted).pipe(Effect.timeout("4 seconds"))
        expect(event.durable).toEqual(expect.objectContaining({ aggregateID: id, seq: expect.any(Number) }))
      }),
    ),
  10_000,
)

it.live(
  "independent embedded hosts do not share live notifications",
  () =>
    withEmbedded("opencode-embedded-hosts-", (fixture) =>
      Effect.gen(function* () {
        const first = yield* fixture.sdk.OpenCode.create()
        const second = yield* fixture.sdk.OpenCode.create()
        const id = sessionID(fixture)
        const firstReady = yield* Latch.make(false)
        const secondReady = yield* Latch.make(false)
        const firstEvent = yield* Latch.make(false)
        const secondEvent = yield* Latch.make(false)
        const observe = (ready: Latch.Latch, event: Latch.Latch) =>
          Stream.runForEach((notification: OpenCodeEvent) =>
            notification.type === "server.connected"
              ? ready.open
              : notification.type === "session.next.agent.switched" && notification.data.sessionID === id
                ? event.open
                : Effect.void,
          )

        yield* first.events.subscribe().pipe(observe(firstReady, firstEvent), Effect.forkScoped)
        yield* second.events.subscribe().pipe(observe(secondReady, secondEvent), Effect.forkScoped)
        yield* Effect.all([firstReady.await, secondReady.await], { discard: true })
        yield* first.sessions.create({ id, location: location(fixture) })
        yield* first.sessions.switchAgent({ sessionID: id, agent: fixture.sdk.Agent.ID.make("plan") })

        yield* firstEvent.await.pipe(Effect.timeout("2 seconds"))
        expect(Option.isNone(yield* secondEvent.await.pipe(Effect.timeoutOption("100 millis")))).toBe(true)
      }),
    ),
  10_000,
)

it.live("embedded client is available as a Layer service", () =>
  withEmbedded("opencode-embedded-layer-", (fixture) => {
    const id = sessionID(fixture)
    return Effect.gen(function* () {
      const opencode = yield* fixture.sdk.OpenCode.Service
      const created = yield* opencode.sessions.create({ id, location: location(fixture) })
      expect(created.id).toBe(id)
    }).pipe(Effect.provide(fixture.sdk.OpenCode.layer))
  }),
)
