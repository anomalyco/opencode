import path from "path"
import { describe, expect } from "bun:test"
import { produce } from "immer"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Connector } from "@opencode-ai/core/connector"
import { Catalog } from "@opencode-ai/core/catalog"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { CredentialPlugin } from "@opencode-ai/core/plugin/credential"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(PluginV2.locationLayer.pipe(Layer.provide(EventV2.defaultLayer)))

function context(
  records: { provider: ProviderV2.Info; models: Map<ModelV2.ID, ModelV2.Info> }[],
  updates: Array<{ id: ProviderV2.ID; enabled: ProviderV2.Info["enabled"]; apiKey?: string }>,
): Catalog.Editor {
  return {
    provider: {
      list: () => records,
      get: (providerID) => records.find((item) => item.provider.id === providerID),
      update: (providerID, fn) => {
        const record = records.find((item) => item.provider.id === providerID)
        const provider = produce(record?.provider ?? ProviderV2.Info.empty(providerID), fn)
        if (record) record.provider = provider
        else records.push({ provider, models: new Map<ModelV2.ID, ModelV2.Info>() })
        updates.push({
          id: providerID,
          enabled: provider.enabled,
          apiKey: typeof provider.request.body.apiKey === "string" ? provider.request.body.apiKey : undefined,
        })
      },
      remove: (providerID) => {
        const index = records.findIndex((item) => item.provider.id === providerID)
        if (index !== -1) records.splice(index, 1)
      },
    },
    model: {
      get: () => undefined,
      update: () => {},
      remove: () => {},
      default: {
        get: () => undefined,
        set: () => {},
      },
    },
  }
}

function testLayer(directory: string) {
  return Credential.layer.pipe(
    Layer.fresh,
    Layer.provide(Database.layerFromPath(path.join(directory, "credential.db")).pipe(Layer.fresh)),
    Layer.provideMerge(EventV2.defaultLayer),
  )
}

describe("Credential", () => {
  it.live("emits credential lifecycle events", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const eventSvc = yield* EventV2.Service
          const addedFiber = yield* eventSvc
            .subscribe(Credential.Event.Added)
            .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
          const switchedFiber = yield* eventSvc
            .subscribe(Credential.Event.Switched)
            .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
          const removedFiber = yield* eventSvc
            .subscribe(Credential.Event.Removed)
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

          yield* Effect.yieldNow

          const first = yield* credentials.create({
            connectorID: Connector.ID.make("lifecycle"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "raw-key" }),
          })
          expect(first).toBeDefined()
          if (!first) return
          expect(first.label).toBe("default")
          expect(first.value.type).toBe("key")
          if (first.value.type === "key") expect(first.value.key).toBe("raw-key")

          yield* credentials.update(first.id, { label: "keep" })
          const updated = yield* credentials.get(first.id)
          expect(updated?.label).toBe("keep")
          expect(updated?.value.type).toBe("key")
          if (updated?.value.type === "key") expect(updated.value.key).toBe("raw-key")

          const second = yield* credentials.create({
            connectorID: Connector.ID.make("lifecycle"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "second-key" }),
          })
          expect(second).toBeDefined()
          if (!second) return

          yield* credentials.remove(second.id)
          const added = Array.from(yield* Fiber.join(addedFiber))
          const switched = Array.from(yield* Fiber.join(switchedFiber))
          const removed = Array.from(yield* Fiber.join(removedFiber))
          expect(added.map((event) => event.data.credential.id)).toEqual([first.id, second.id])
          expect(switched.map((event) => event.data)).toEqual([
            { connectorID: Connector.ID.make("lifecycle"), from: undefined, to: first.id },
            { connectorID: Connector.ID.make("lifecycle"), from: first.id, to: second.id },
            { connectorID: Connector.ID.make("lifecycle"), from: second.id, to: first.id },
          ])
          expect(removed[0]?.data.credential.id).toBe(second.id)
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("always switches to newly created credentials", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const eventSvc = yield* EventV2.Service
          const switchedFiber = yield* eventSvc
            .subscribe(Credential.Event.Switched)
            .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)

          yield* Effect.yieldNow

          const first = yield* credentials.create({
            connectorID: Connector.ID.make("switch"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "first-key" }),
          })
          const second = yield* credentials.create({
            connectorID: Connector.ID.make("switch"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "second-key" }),
          })
          const third = yield* credentials.create({
            connectorID: Connector.ID.make("switch"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "third-key" }),
          })

          expect(first).toBeDefined()
          expect(second).toBeDefined()
          expect(third).toBeDefined()
          if (!first || !second || !third) return

          expect((yield* credentials.active(Connector.ID.make("switch")))?.id).toBe(third.id)
          expect(Array.from(yield* Fiber.join(switchedFiber)).map((event) => event.data)).toEqual([
            { connectorID: Connector.ID.make("switch"), from: undefined, to: first.id },
            { connectorID: Connector.ID.make("switch"), from: first.id, to: second.id },
            { connectorID: Connector.ID.make("switch"), from: second.id, to: third.id },
          ])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("credential plugin refreshes providers on credential lifecycle events", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const plugin = yield* PluginV2.Service
          const records = [
            {
              provider: ProviderV2.Info.empty(ProviderV2.ID.make("provider")),
              models: new Map<ModelV2.ID, ModelV2.Info>(),
            },
          ]
          const updates: Array<{ id: ProviderV2.ID; enabled: ProviderV2.Info["enabled"]; apiKey?: string }> = []
          const catalog = Catalog.Service.of({
            transform: () => Effect.die("unexpected catalog.transform"),
            provider: {
              get: () => Effect.die("unexpected provider.get"),
              all: () => Effect.succeed([]),
              available: () => Effect.succeed([]),
            },
            model: {
              get: () => Effect.die("unexpected model.get"),
              all: () => Effect.succeed([]),
              available: () => Effect.succeed([]),
              default: () => Effect.succeed(Option.none<ModelV2.Info>()),
              small: () => Effect.succeed(Option.none<ModelV2.Info>()),
            },
          })

          const eventSvc = yield* EventV2.Service
          yield* plugin.add({
            ...CredentialPlugin,
            effect: CredentialPlugin.effect.pipe(
              Effect.provideService(Credential.Service, credentials),
              Effect.provideService(Catalog.Service, catalog),
              Effect.provideService(EventV2.Service, eventSvc),
              Effect.provideService(PluginV2.Service, plugin),
            ),
          })
          yield* Effect.yieldNow

          const first = yield* credentials.create({
            connectorID: Connector.ID.make("provider"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "first-key" }),
          })
          expect(first).toBeDefined()
          if (!first) return
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "credential", connector: Connector.ID.make("provider") },
              apiKey: "first-key",
            },
          ])

          updates.length = 0
          const second = yield* credentials.create({
            connectorID: Connector.ID.make("provider"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "second-key" }),
          })
          expect(second).toBeDefined()
          if (!second) return
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "credential", connector: Connector.ID.make("provider") },
              apiKey: "second-key",
            },
          ])

          updates.length = 0
          yield* credentials.activate(first.id)
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "credential", connector: Connector.ID.make("provider") },
              apiKey: "first-key",
            },
          ])

          updates.length = 0
          yield* credentials.remove(first.id)
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "credential", connector: Connector.ID.make("provider") },
              apiKey: "second-key",
            },
          ])

          updates.length = 0
          yield* credentials.remove(second.id)
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )
})
