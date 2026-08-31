import fs from "fs/promises"
import path from "path"
import { expect } from "bun:test"
import { LanguageModel, LLMClient } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { TestLLM } from "@opencode-ai/ai/testing"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { makeMemoryDriver } from "@opencode-ai/core/environment/index"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Deferred, Effect, Fiber, Latch, Layer, Option, Ref, Schema, Stream } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import type { OpenCodeEvent } from "../src/effect"

const it = testEffect(Layer.empty)
type Sdk = typeof import("../src/effect")
type Fixture = { readonly directory: string; readonly sdk: Sdk }

const withEmbedded = <A, E, R>(prefix: string, f: (fixture: Fixture) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(prefix)),
    (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((directory) =>
      Effect.promise(() => import("../src/effect")).pipe(
        Effect.flatMap((sdk) => f({ directory: directory.path, sdk })),
      ),
    ),
  )

const sessionID = (fixture: Fixture) => fixture.sdk.Session.ID.create()

const location = (fixture: Fixture) =>
  fixture.sdk.Location.Ref.make({ directory: fixture.sdk.AbsolutePath.make(fixture.directory) })

for (const selection of ["explicit", "default"] as const) {
  it.live(`first generate.text waits for inline providers with ${selection} model selection`, () =>
    withEmbedded("opencode-embedded-generate-", (fixture) =>
      Effect.gen(function* () {
        const release = yield* Latch.make()
        const llm = yield* TestLLM.Test.pipe(
          Effect.provide(TestLLM.testLayer({ fallback: TestLLM.text("ready", "answer") })),
        )
        const supervisor = PluginSupervisor.node.mapLayer((layer) =>
          Layer.effect(
            PluginSupervisor.Service,
            Effect.gen(function* () {
              const plugins = yield* PluginSupervisor.Service
              return { flush: release.open.pipe(Effect.andThen(plugins.flush)) }
            }),
          ).pipe(Layer.provide(layer)),
        )
        const opencode = yield* fixture.sdk.OpenCode.create(
          {
            config: {
              directory: fixture.directory,
              project: false,
              content: JSON.stringify({
                model: "custom/fictional-chat",
                providers: {
                  custom: {
                    package: "aisdk:@ai-sdk/openai-compatible",
                    settings: { baseURL: "https://provider.example/v1" },
                    models: { "fictional-chat": {} },
                  },
                },
              }),
            },
            models: { fetch: false },
            fs: { filewatcher: false },
          },
          {
            overrides: [
              llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
              PluginSupervisor.node.replace(supervisor),
            ],
          },
        )
        // Hold provider activation until the request reaches readiness, regardless of startup speed.
        yield* opencode.plugin({ id: "gate-catalog", effect: () => release.await })

        const result = yield* opencode.generate.text({
          prompt: "Say ready",
          ...(selection === "explicit"
            ? {
                model: fixture.sdk.Model.Ref.make({
                  providerID: fixture.sdk.Provider.ID.make("custom"),
                  id: fixture.sdk.Model.ID.make("fictional-chat"),
                }),
              }
            : {}),
        })

        expect(result.text).toBe("ready")
        const requests = yield* llm.requests()
        expect(requests).toHaveLength(1)
        expect(requests[0]?.model).toMatchObject({ provider: "custom", id: "fictional-chat" })
      }),
    ),
  )
}

it.live("exposes app metadata to plugins", () =>
  withEmbedded("opencode-embedded-app-", (fixture) =>
    Effect.gen(function* () {
      const opencode = yield* fixture.sdk.OpenCode.create({
        app: { name: "test", version: "1.2.3", channel: "beta" },
      })
      const app = yield* Deferred.make<{ readonly name: string; readonly version: string; readonly channel: string }>()
      yield* opencode.plugin({
        id: `app-${crypto.randomUUID()}`,
        effect: (ctx) => Deferred.succeed(app, ctx.app).pipe(Effect.asVoid),
      })
      yield* opencode.plugin.list({ location: location(fixture) })
      expect(yield* Deferred.await(app).pipe(Effect.timeout("4 seconds"))).toEqual({
        name: "test",
        version: "1.2.3",
        channel: "beta",
      })
    }),
  ),
)

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
                  draft.add({
                    name: "bootstrap_sdk_tool",
                    description: "Marks the initial Location plugin generation",
                    input: Schema.Struct({}),
                    output: Schema.Void,
                    execute: () => Effect.succeed({ output: undefined }),
                  }),
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
                  draft.add({
                    name: "late_sdk_tool",
                    description: "Tool registered after Location boot",
                    input: Schema.Struct({}),
                    output: Schema.Void,
                    execute: () => Effect.succeed({ output: undefined }),
                  }),
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
        yield* opencode.debug.location.evict({ location: ref })
        yield* opencode.plugin.list({ location: ref })
        yield* Deferred.await(recommitted).pipe(Effect.timeout("5 seconds"))

        expect((yield* opencode.plugin.list({ location: ref })).data.map((plugin) => String(plugin.id))).toContain(id)
      }),
    ),
  15_000,
)

it.live(
  "evicts a Location without triggering connected client refetches",
  () =>
    withEmbedded("opencode-embedded-quiet-eviction-", (fixture) =>
      Effect.gen(function* () {
        const opencode = yield* fixture.sdk.OpenCode.create({
          config: { directory: fixture.directory, project: false, content: "{}" },
        })
        const ref = location(fixture)
        const connected = yield* Latch.make(false)
        const booted = yield* Deferred.make<void>()
        const boots = yield* Ref.make(0)
        const updates = yield* Ref.make<string[]>([])

        yield* opencode.plugin({
          id: `quiet-eviction-${crypto.randomUUID()}`,
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* Ref.update(boots, (count) => count + 1)
              yield* ctx.catalog.transform((catalog) => catalog.provider.update("eviction-test", () => {}))
              yield* ctx.agent.transform((agents) => agents.update("eviction-test", () => {}))
              yield* ctx.command.transform((commands) =>
                commands.add({ name: "eviction-test", execute: () => Effect.void }),
              )
            }),
        })
        const subscriber = yield* opencode.events.subscribe().pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "server.connected") {
                yield* connected.open
                return
              }
              if (event.location?.directory !== fixture.directory) return
              if (event.type === "plugin.updated") {
                yield* Deferred.succeed(booted, undefined)
                return
              }
              if (
                event.type !== "catalog.updated" &&
                event.type !== "agent.updated" &&
                event.type !== "command.updated"
              )
                return
              yield* Ref.update(updates, (types) => [...types, event.type])
              // A connected consumer re-reads invalidated resources through the real router.
              if (event.type === "catalog.updated") {
                yield* opencode.model.list({ location: ref })
                yield* opencode.provider.list({ location: ref })
                return
              }
              if (event.type === "agent.updated") {
                yield* opencode.agent.list({ location: ref })
                return
              }
              yield* opencode.command.list({ location: ref })
            }),
          ),
          Effect.forkScoped,
        )
        yield* connected.await
        yield* opencode.plugin.list({ location: ref })
        yield* Deferred.await(booted).pipe(Effect.timeout("5 seconds"))
        expect(yield* Ref.get(updates)).toEqual(
          expect.arrayContaining(["catalog.updated", "agent.updated", "command.updated"]),
        )
        yield* Ref.set(updates, [])

        yield* opencode.debug.location.evict({ location: ref })
        // Allow the live event stream to deliver teardown notifications and any refetches.
        yield* Effect.sleep("200 millis")

        expect(yield* Ref.get(updates)).toEqual([])
        expect(yield* Ref.get(boots)).toBe(1)
        expect(yield* opencode.debug.location.list()).toEqual([])
        expect(subscriber.pollUnsafe()).toBeUndefined()
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
        const opencode = yield* fixture.sdk.OpenCode.create({ events: { persist: true } })
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
                draft.add({
                  name: "embedded_tool",
                  description: "Embedded test tool",
                  input: Schema.Struct({}),
                  output: Schema.Struct({ ok: Schema.Boolean }),
                  execute: () => Effect.succeed({ output: { ok: true } }),
                }),
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
          text: "Do not run",
          resume: false,
        })
        const context = yield* opencode.sessions.context({ sessionID: id })
        const pendingAfterAdmit = yield* opencode.sessions.inbox.list({ sessionID: id })
        yield* opencode.sessions.instructions.entry.put({ sessionID: id, key: "deploy-target", value: "production" })
        yield* opencode.sessions.instructions.entry.put({ sessionID: id, key: "flags", value: { beta: true } })
        const contextEntries = yield* opencode.sessions.instructions.entry.list({ sessionID: id })
        yield* opencode.sessions.instructions.entry.remove({ sessionID: id, key: "flags" })
        const remainingContextEntries = yield* opencode.sessions.instructions.entry.list({ sessionID: id })
        const wake = yield* opencode.sessions.prompt({
          sessionID: id,
          text: "Promote this input",
        })
        const prompted = yield* opencode.sessions.log({ sessionID: id, follow: true }).pipe(
          Stream.filter((event) => event.type === "session.inbox.delivered" && event.data.inboxID === wake.id),
          Stream.runHead,
          Effect.timeout("10 seconds"),
          Effect.map(Option.getOrThrow),
        )
        const wakeContext = yield* opencode.sessions.context({ sessionID: id })
        const pendingAfterPromote = yield* opencode.sessions.inbox.list({ sessionID: id })
        const event = yield* opencode.sessions.log({ sessionID: id }).pipe(
          Stream.filter((item) => item.type === "session.model.selected"),
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
            opencode.sessions.inbox.list({ sessionID: missingSessionID }).pipe(Effect.flip),
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
        expect(pendingAfterAdmit).toContainEqual(
          expect.objectContaining({ id: admitted.id, type: "user", delivery: "steer" }),
        )
        expect(prompted.type).toBe("session.inbox.delivered")
        expect(pendingAfterPromote.map((item) => item.id)).not.toContainAnyValues([admitted.id, wake.id])
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
          "SessionNotFoundError",
        ])
        expect(missingMessage._tag).toBe("MessageNotFoundError")
      }),
    ),
  10_000,
)

it.live("embedded client exposes plugin-backed web search", () =>
  withEmbedded("opencode-embedded-websearch-", (fixture) =>
    Effect.gen(function* () {
      const opencode = yield* fixture.sdk.OpenCode.create()
      const providerID = fixture.sdk.WebSearch.ID.make("embedded-websearch")
      yield* opencode.plugin({
        id: `embedded-websearch-${crypto.randomUUID()}`,
        effect: (ctx) =>
          ctx.websearch.transform((draft) => {
            draft.add({
              id: providerID,
              name: "Embedded web search",
              execute: (input) =>
                Effect.succeed([{ url: "https://example.com", content: `Found ${input.query}`, time: {} }]),
            })
          }),
      })

      const result = yield* opencode.websearch.query({
        query: "opencode",
        providerID,
        location: location(fixture),
      })

      expect(result.data).toEqual({
        providerID,
        results: [{ url: "https://example.com", content: "Found opencode", time: {} }],
      })
    }),
  ),
)

it.live(
  "Location-owned runner events reach the ready global client",
  () =>
    withEmbedded("opencode-embedded-events-", (fixture) =>
      Effect.gen(function* () {
        const opencode = yield* fixture.sdk.OpenCode.create()
        const id = sessionID(fixture)
        const connected = yield* Latch.make(false)
        const prompted = yield* Deferred.make<Extract<OpenCodeEvent, { type: "session.inbox.delivered" }>>()

        yield* opencode.events.subscribe().pipe(
          Stream.runForEach((event) =>
            event.type === "server.connected"
              ? connected.open
              : event.type === "session.inbox.delivered" && event.data.sessionID === id
                ? Deferred.succeed(prompted, event).pipe(Effect.asVoid)
                : Effect.void,
          ),
          Effect.forkScoped,
        )
        yield* connected.await
        yield* opencode.sessions.create({ id, location: location(fixture) })
        yield* opencode.sessions.prompt({
          sessionID: id,
          text: "Observe this input",
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
    }).pipe(Effect.provide(fixture.sdk.OpenCode.layer()))
  }),
)

it.live("configures workspace providers through the SDK facade", () =>
  withEmbedded("opencode-embedded-workspace-", (fixture) =>
    Effect.gen(function* () {
      const calls: Array<{ readonly operation: string; readonly workspaceID: string }> = []
      const driver = WorkspaceDriver.make({
        create: ({ workspaceID }) => {
          calls.push({ operation: "create", workspaceID })
          return Effect.succeed({ binding: { externalID: workspaceID } })
        },
        connect: ({ workspaceID }) => {
          calls.push({ operation: "connect", workspaceID })
          return Effect.succeed(makeMemoryDriver())
        },
        suspendForIdle: () => Effect.void,
        destroy: ({ workspaceID }) => {
          calls.push({ operation: "destroy", workspaceID })
          return Effect.void
        },
      })
      const opencode = yield* fixture.sdk.OpenCode.create({ workspaceProviders: { fake: driver } })
      const requestedID = fixture.sdk.Workspace.ID.create()
      const workspaceID = yield* opencode.workspace.create({ id: requestedID, provider: "fake" })

      expect(workspaceID).toBe(requestedID)
      expect(yield* opencode.workspace.create({ id: requestedID, provider: "fake" })).toBe(requestedID)
      expect(calls).toEqual([])

      const workspace = yield* opencode.workspace.provision({ workspaceID })

      expect(workspace.provider).toBe("fake")
      expect(workspace.binding).toEqual({ externalID: workspace.id })
      expect(calls).toEqual([{ operation: "create", workspaceID: workspace.id }])

      const workspaceLocation = fixture.sdk.Location.Ref.make({
        directory: fixture.sdk.AbsolutePath.make("/"),
        workspaceID: workspace.id,
      })
      const session = yield* opencode.sessions.create({ location: workspaceLocation })
      expect(session.location.workspaceID).toBe(workspace.id)

      expect(yield* opencode.workspace.destroy({ workspaceID: workspace.id })).toEqual({ destroyed: true })
      expect(calls.map((call) => call.operation)).toEqual(["create", "destroy"])
      expect(yield* opencode.workspace.destroy({ workspaceID: workspace.id })).toEqual({ destroyed: false })
      expect(calls.map((call) => call.operation)).toEqual(["create", "destroy"])
    }),
  ),
)

const workspaceModelScenario = (fixture: Fixture, policy: "eager" | "lazy") =>
  Effect.gen(function* () {
    const calls: string[] = []
    const createStarted = yield* Deferred.make<void>()
    const createRelease = yield* Deferred.make<void>()
    const modelStarted = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(createRelease, undefined).pipe(Effect.asVoid))
    const model = LanguageModel.make({ id: "workspace-test", provider: "test", route: OpenAIChat.route })
    const client = TestLLM.testLayer({
      fallback: TestLLM.text("ready", "answer"),
      transformRequest: (request) => {
        Deferred.doneUnsafe(modelStarted, Effect.void)
        return request
      },
    })
    const models = Layer.mock(SessionRunnerModel.Service, {
      resolve: () =>
        Effect.succeed(
          SessionRunnerModel.resolved(model, {
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            cost: [],
            limit: { context: 100_000, output: 1_000 },
          }),
        ),
    })
    const driver = WorkspaceDriver.make({
      create: ({ workspaceID }) => {
        calls.push("create")
        return Deferred.succeed(createStarted, undefined).pipe(
          Effect.andThen(Deferred.await(createRelease)),
          Effect.as({ binding: { workspaceID } }),
        )
      },
      connect: () => {
        calls.push("connect")
        return Effect.succeed(makeMemoryDriver())
      },
      suspendForIdle: () => Effect.void,
      destroy: () => Effect.void,
    })
    const configDirectory = path.join(fixture.directory, "config")
    yield* Effect.promise(() => fs.mkdir(configDirectory))
    const opencode = yield* fixture.sdk.OpenCode.create(
      {
        config: { directory: configDirectory, project: false, content: "{}" },
        workspaceProviders: { fake: driver },
      },
      {
        overrides: [llmClient.replace(client), SessionRunnerModel.node.replace(models)],
      },
    )
    const workspaceID = yield* opencode.workspace.create({ provider: "fake" })
    const provisioning =
      policy === "eager"
        ? yield* opencode.workspace.provision({ workspaceID }).pipe(Effect.forkScoped({ startImmediately: true }))
        : undefined
    if (provisioning) {
      yield* Deferred.await(createStarted).pipe(
        Effect.timeoutOrElse({ duration: "4 seconds", orElse: () => Effect.die("provider create did not start") }),
      )
    }

    const session = yield* opencode.sessions.create({
      location: fixture.sdk.Location.Ref.make({
        directory: fixture.sdk.AbsolutePath.make(fixture.directory),
        workspaceID,
      }),
    })
    yield* opencode.sessions.prompt({ sessionID: session.id, text: "Answer without using tools" })
    yield* Deferred.await(modelStarted).pipe(
      Effect.timeoutOrElse({ duration: "8 seconds", orElse: () => Effect.die("model stream did not start") }),
    )

    if (!provisioning) {
      expect(calls).toEqual([])
      return
    }
    expect(provisioning.pollUnsafe()).toBeUndefined()
    expect(calls).toEqual(["create"])
    yield* Deferred.succeed(createRelease, undefined)
    expect((yield* Fiber.join(provisioning)).binding).toEqual({ workspaceID })
    expect(calls).toEqual(["create"])
  })

it.live(
  "starts model execution while eager workspace provisioning is blocked",
  () => withEmbedded("opencode-embedded-workspace-eager-", (fixture) => workspaceModelScenario(fixture, "eager")),
  15_000,
)

it.live(
  "starts model execution without provisioning a lazy workspace",
  () => withEmbedded("opencode-embedded-workspace-lazy-", (fixture) => workspaceModelScenario(fixture, "lazy")),
  15_000,
)

it.live(
  "blocks the model-selected first tool on lazy provisioning",
  () =>
    withEmbedded("opencode-embedded-workspace-tool-", (fixture) =>
      Effect.gen(function* () {
        const calls: string[] = []
        const createStarted = yield* Deferred.make<void>()
        const createRelease = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(createRelease, undefined).pipe(Effect.asVoid))
        const model = LanguageModel.make({ id: "workspace-tool-test", provider: "test", route: OpenAIChat.route })
        // The first tool-advertising request selects the shell tool; everything else
        // (including title generation, which carries no tools) answers with text.
        let toolIssued = false
        const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
        yield* llm.serve((request) => {
          const wantsTool = !toolIssued && request.tools.some((tool) => tool.name === "shell")
          if (!wantsTool) return TestLLM.text("done", "answer")
          toolIssued = true
          return TestLLM.tool("call-shell", "shell", { command: "echo hi" })
        })
        const models = Layer.mock(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(model, {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: [],
                limit: { context: 100_000, output: 1_000 },
              }),
            ),
        })
        const driver = WorkspaceDriver.make({
          create: ({ workspaceID }) => {
            calls.push("create")
            return Deferred.succeed(createStarted, undefined).pipe(
              Effect.andThen(Deferred.await(createRelease)),
              Effect.as({ binding: { workspaceID } }),
            )
          },
          connect: () => {
            calls.push("connect")
            return Effect.succeed(makeMemoryDriver())
          },
          suspendForIdle: () => Effect.void,
          destroy: () => Effect.void,
        })
        const configDirectory = path.join(fixture.directory, "config")
        yield* Effect.promise(() => fs.mkdir(configDirectory))
        const opencode = yield* fixture.sdk.OpenCode.create(
          {
            config: { directory: configDirectory, project: false, content: "{}" },
            workspaceProviders: { fake: driver },
          },
          {
            overrides: [
              llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
              SessionRunnerModel.node.replace(models),
            ],
          },
        )
        const workspaceID = yield* opencode.workspace.create({ provider: "fake" })
        const session = yield* opencode.sessions.create({
          location: fixture.sdk.Location.Ref.make({
            directory: fixture.sdk.AbsolutePath.make(fixture.directory),
            workspaceID,
          }),
        })
        expect(calls).toEqual([])

        yield* opencode.sessions.prompt({ sessionID: session.id, text: "Run echo" })
        // The model-selected shell tool is the first execution-plane demand: it alone
        // starts provisioning and blocks inside the tool call until the provider is ready.
        yield* Deferred.await(createStarted).pipe(
          Effect.timeoutOrElse({ duration: "8 seconds", orElse: () => Effect.die("first tool did not provision") }),
        )
        expect(calls).toEqual(["create"])

        yield* Deferred.succeed(createRelease, undefined)
        yield* opencode.sessions.wait({ sessionID: session.id })
        // Provisioning settled, the workspace connected, and the turn completed. The
        // memory driver rejects the actual spawn, which surfaces to the model as an
        // ordinary tool error before the final text response.
        expect(calls).toEqual(["create", "connect"])
        expect(toolIssued).toBe(true)
      }),
    ),
  15_000,
)

it.live("preserves unknown workspace provider errors", () =>
  withEmbedded("opencode-embedded-workspace-provider-", (fixture) =>
    Effect.gen(function* () {
      const opencode = yield* fixture.sdk.OpenCode.create()
      const error = yield* opencode.workspace.create({ provider: "missing" }).pipe(Effect.flip)
      expect(error).toEqual(new WorkspaceDriver.ProviderNotFound({ provider: "missing" }))
    }),
  ),
)
