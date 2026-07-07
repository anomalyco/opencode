import fs from "fs/promises"
import path from "path"
import { expect } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Deferred, Effect, Latch, Layer, Option, Ref, Schema, Stream } from "effect"
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
  "reloads every booted Location after SDK plugin registration",
  () =>
    withEmbedded("opencode-embedded-plugin-reload-", (fixture) =>
      Effect.gen(function* () {
        const opencode = yield* fixture.sdk.OpenCode.create()
        const booted = yield* Deferred.make<void>()
        const activated = yield* Deferred.make<boolean>()
        const bootCount = yield* Ref.make(0)
        const activationCount = yield* Ref.make(0)
        const secondDirectory = path.join(fixture.directory, "second")
        yield* Effect.promise(() => fs.mkdir(secondDirectory))
        const refs = [
          location(fixture),
          fixture.sdk.Location.Ref.make({ directory: fixture.sdk.AbsolutePath.make(secondDirectory) }),
        ]
        const bootstrapID = `bootstrap-sdk-${crypto.randomUUID()}`
        const id = `late-sdk-${crypto.randomUUID()}`

        yield* opencode.plugin({
          id: bootstrapID,
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.tool
                .transform((draft) =>
                  draft.add(
                    "bootstrap_sdk_tool",
                    fixture.sdk.Tool.make({
                      description: "Marks the initial Location plugin generation",
                      input: Schema.Struct({}),
                      output: Schema.Void,
                      execute: () => Effect.void,
                    }),
                  ),
                )
                .pipe(Effect.orDie)
              if (yield* Ref.updateAndGet(bootCount, (count) => count + 1).pipe(Effect.map((count) => count === 2))) {
                yield* Deferred.succeed(booted, undefined)
              }
            }),
        })
        yield* Effect.all(
          refs.map((ref) => opencode.plugin.list({ location: ref })),
          { discard: true },
        )
        yield* Deferred.await(booted).pipe(Effect.timeout("4 seconds"))
        yield* opencode.plugin({
          id,
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.tool
                .transform((draft) =>
                  draft.add(
                    "late_sdk_tool",
                    fixture.sdk.Tool.make({
                      description: "Tool registered after Location boot",
                      input: Schema.Struct({}),
                      output: Schema.Void,
                      execute: () => Effect.void,
                    }),
                  ),
                )
                .pipe(Effect.orDie)
              if (
                yield* Ref.updateAndGet(activationCount, (count) => count + 1).pipe(Effect.map((count) => count === 2))
              ) {
                yield* Deferred.succeed(activated, true)
              }
            }),
        })

        expect(yield* Deferred.await(activated).pipe(Effect.timeout("10 seconds"))).toBe(true)
      }),
    ),
  25_000,
)

it.live(
  "preserves SDK plugins across Location eviction",
  () =>
    withEmbedded("opencode-embedded-plugin-eviction-", (fixture) =>
      Effect.gen(function* () {
        const opencode = yield* fixture.sdk.OpenCode.create()
        const ref = location(fixture)
        const connected = yield* Latch.make(false)
        const booted = yield* Deferred.make<void>()
        // The rebooted Location commits its second plugin generation.
        const recommitted = yield* Deferred.make<void>()
        const generations = yield* Ref.make(0)
        const id = `evicted-sdk-${crypto.randomUUID()}`

        yield* opencode.events.subscribe().pipe(
          Stream.runForEach((event) => {
            if (event.type === "server.connected") return connected.open
            if (event.type !== "plugin.updated" || event.location?.directory !== fixture.directory) return Effect.void
            return Ref.updateAndGet(generations, (total) => total + 1).pipe(
              Effect.flatMap((total) => {
                if (total === 1) return Deferred.succeed(booted, undefined)
                if (total === 2) return Deferred.succeed(recommitted, undefined)
                return Effect.void
              }),
              Effect.asVoid,
            )
          }),
          Effect.forkScoped,
        )
        yield* connected.await
        yield* opencode.plugin({ id, effect: () => Effect.void })

        yield* opencode.plugin.list({ location: ref })
        yield* Deferred.await(booted).pipe(Effect.timeout("5 seconds"))
        yield* opencode.debug.evictLocation({ location: ref })
        yield* opencode.plugin.list({ location: ref })
        yield* Deferred.await(recommitted).pipe(Effect.timeout("5 seconds"))

        expect((yield* opencode.plugin.list({ location: ref })).data.map((plugin) => String(plugin.id))).toContain(id)
      }),
    ),
  15_000,
)

it.live(
  "keeps SDK plugin registration isolated between embedded hosts",
  () =>
    withEmbedded("opencode-embedded-plugin-isolation-", (fixture) =>
      Effect.gen(function* () {
        const first = yield* fixture.sdk.OpenCode.create()
        const second = yield* fixture.sdk.OpenCode.create()
        const firstReady = yield* Deferred.make<void>()
        const secondReady = yield* Deferred.make<void>()
        const activated = yield* Deferred.make<void>()
        const ref = location(fixture)
        const id = `isolated-sdk-${crypto.randomUUID()}`

        yield* first.plugin({
          id: `first-ready-${crypto.randomUUID()}`,
          effect: () => Deferred.succeed(firstReady, undefined),
        })
        yield* second.plugin({
          id: `second-ready-${crypto.randomUUID()}`,
          effect: () => Deferred.succeed(secondReady, undefined),
        })
        yield* Effect.all([first.plugin.list({ location: ref }), second.plugin.list({ location: ref })], {
          discard: true,
        })
        yield* Effect.all([Deferred.await(firstReady), Deferred.await(secondReady)], { discard: true })

        yield* first.plugin({ id, effect: () => Deferred.succeed(activated, undefined) })
        yield* Deferred.await(activated).pipe(Effect.timeout("5 seconds"))

        expect((yield* second.plugin.list({ location: ref })).data.map((plugin) => String(plugin.id))).not.toContain(id)
      }),
    ),
  15_000,
)

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
              .transform((draft) =>
                draft.add(
                  "embedded_tool",
                  fixture.sdk.Tool.make({
                    description: "Embedded test tool",
                    input: Schema.Struct({}),
                    output: Schema.Struct({ ok: Schema.Boolean }),
                    execute: () => Effect.succeed({ ok: true }),
                  }),
                ),
              )
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
          prompt: fixture.sdk.PromptInput.Prompt.make({ text: "Do not run" }),
          resume: false,
        })
        const context = yield* opencode.sessions.context({ sessionID: id })
        yield* opencode.sessions.instructions.entry.put({ sessionID: id, key: "deploy-target", value: "production" })
        yield* opencode.sessions.instructions.entry.put({ sessionID: id, key: "flags", value: { beta: true } })
        const contextEntries = yield* opencode.sessions.instructions.entry.list({ sessionID: id })
        yield* opencode.sessions.instructions.entry.remove({ sessionID: id, key: "flags" })
        const remainingContextEntries = yield* opencode.sessions.instructions.entry.list({ sessionID: id })
        const wake = yield* opencode.sessions.prompt({
          sessionID: id,
          prompt: fixture.sdk.PromptInput.Prompt.make({ text: "Promote this input" }),
        })
        const prompted = yield* opencode.sessions.log({ sessionID: id, follow: true }).pipe(
          Stream.filter((event) => event.type === "session.prompt.promoted" && event.data.inputID === wake.id),
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
            opencode.sessions.instructions.entry.list({ sessionID: missingSessionID }).pipe(Effect.flip),
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
        expect(active).toEqual({})
        expect(admitted.sessionID).toBe(id)
        expect(prompted.type).toBe("session.prompt.promoted")
        expect(wakeContext).toContainEqual(expect.objectContaining({ id: wake.id, type: "user" }))
        expect(contextEntries).toEqual([
          { key: "deploy-target", value: "production" },
          { key: "flags", value: { beta: true } },
        ])
        expect(remainingContextEntries).toEqual([{ key: "deploy-target", value: "production" }])
        expect(context.some((message) => message.type === "model-switched")).toBe(true)
        expect(event).toMatchObject({ type: "session.model.selected", durable: { seq: 1 } })
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
        const prompted = yield* Deferred.make<Extract<OpenCodeEvent, { type: "session.prompt.promoted" }>>()

        yield* opencode.events.subscribe().pipe(
          Stream.runForEach((event) =>
            event.type === "server.connected"
              ? connected.open
              : event.type === "session.prompt.promoted" && event.data.sessionID === id
                ? Deferred.succeed(prompted, event).pipe(Effect.asVoid)
                : Effect.void,
          ),
          Effect.forkScoped,
        )
        yield* connected.await
        yield* opencode.sessions.create({ id, location: location(fixture) })
        yield* opencode.sessions.prompt({
          sessionID: id,
          prompt: fixture.sdk.PromptInput.Prompt.make({ text: "Observe this input" }),
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
              : notification.type === "session.agent.selected" && notification.data.sessionID === id
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
