import path from "path"
import { describe, expect } from "bun:test"
import { produce } from "immer"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { Auth } from "@opencode-ai/core/auth"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AccountPlugin } from "@opencode-ai/core/plugin/account"
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
          apiKey:
            typeof provider.options.aisdk.provider.apiKey === "string"
              ? provider.options.aisdk.provider.apiKey
              : undefined,
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

function testLayer(dir: string) {
  return Auth.layer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provide(
      Global.layerWith({
        data: dir,
        cache: path.join(dir, "cache"),
        config: path.join(dir, "config"),
        state: path.join(dir, "state"),
        tmp: path.join(dir, "tmp"),
        bin: path.join(dir, "bin"),
        log: path.join(dir, "log"),
        repos: path.join(dir, "repos"),
      }),
    ),
  )
}

describe("Auth", () => {
  it.live("emits account lifecycle events", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const accounts = yield* Auth.Service
          const eventSvc = yield* EventV2.Service
          const addedFiber = yield* eventSvc
            .subscribe(Auth.Event.Added)
            .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
          const switchedFiber = yield* eventSvc
            .subscribe(Auth.Event.Switched)
            .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
          const removedFiber = yield* eventSvc
            .subscribe(Auth.Event.Removed)
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

          yield* Effect.yieldNow

          const first = yield* accounts.create({
            serviceID: Auth.ServiceID.make("provider"),
            credential: new Auth.ApiKeyCredential({ type: "api", key: "raw-key" }),
          })
          expect(first).toBeDefined()
          if (!first) return
          expect(first.description).toBe("default")
          expect(first.credential.type).toBe("api")
          if (first.credential.type === "api") expect(first.credential.key).toBe("raw-key")

          yield* accounts.update(first.id, { description: "keep" })
          const updated = yield* accounts.get(first.id)
          expect(updated?.description).toBe("keep")
          expect(updated?.credential.type).toBe("api")
          if (updated?.credential.type === "api") expect(updated.credential.key).toBe("raw-key")

          const second = yield* accounts.create({
            serviceID: Auth.ServiceID.make("provider"),
            credential: new Auth.ApiKeyCredential({ type: "api", key: "second-key" }),
          })
          expect(second).toBeDefined()
          if (!second) return

          yield* accounts.remove(second.id)
          const added = Array.from(yield* Fiber.join(addedFiber))
          const switched = Array.from(yield* Fiber.join(switchedFiber))
          const removed = Array.from(yield* Fiber.join(removedFiber))
          expect(added.map((event) => event.data.account.id)).toEqual([first.id, second.id])
          expect(switched.map((event) => event.data)).toEqual([
            { serviceID: Auth.ServiceID.make("provider"), from: undefined, to: first.id },
            { serviceID: Auth.ServiceID.make("provider"), from: first.id, to: second.id },
            { serviceID: Auth.ServiceID.make("provider"), from: second.id, to: first.id },
          ])
          expect(removed[0]?.data.account.id).toBe(second.id)
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("always switches to newly created accounts", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const accounts = yield* Auth.Service
          const eventSvc = yield* EventV2.Service
          const switchedFiber = yield* eventSvc
            .subscribe(Auth.Event.Switched)
            .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)

          yield* Effect.yieldNow

          const first = yield* accounts.create({
            serviceID: Auth.ServiceID.make("provider"),
            credential: new Auth.ApiKeyCredential({ type: "api", key: "first-key" }),
          })
          const second = yield* accounts.create({
            serviceID: Auth.ServiceID.make("provider"),
            credential: new Auth.ApiKeyCredential({ type: "api", key: "second-key" }),
          })
          const third = yield* accounts.create({
            serviceID: Auth.ServiceID.make("provider"),
            credential: new Auth.ApiKeyCredential({ type: "api", key: "third-key" }),
          })

          expect(first).toBeDefined()
          expect(second).toBeDefined()
          expect(third).toBeDefined()
          if (!first || !second || !third) return

          expect((yield* accounts.active(Auth.ServiceID.make("provider")))?.id).toBe(third.id)
          expect(Array.from(yield* Fiber.join(switchedFiber)).map((event) => event.data)).toEqual([
            { serviceID: Auth.ServiceID.make("provider"), from: undefined, to: first.id },
            { serviceID: Auth.ServiceID.make("provider"), from: first.id, to: second.id },
            { serviceID: Auth.ServiceID.make("provider"), from: second.id, to: third.id },
          ])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("account plugin refreshes providers on account lifecycle events", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const accounts = yield* Auth.Service
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
            ...AccountPlugin,
            effect: AccountPlugin.effect.pipe(
              Effect.provideService(Auth.Service, accounts),
              Effect.provideService(Catalog.Service, catalog),
              Effect.provideService(EventV2.Service, eventSvc),
              Effect.provideService(PluginV2.Service, plugin),
            ),
          })
          yield* Effect.yieldNow

          const first = yield* accounts.create({
            serviceID: Auth.ServiceID.make("provider"),
            credential: new Auth.ApiKeyCredential({ type: "api", key: "first-key" }),
          })
          expect(first).toBeDefined()
          if (!first) return
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "account", service: Auth.ServiceID.make("provider") },
              apiKey: "first-key",
            },
          ])

          updates.length = 0
          const second = yield* accounts.create({
            serviceID: Auth.ServiceID.make("provider"),
            credential: new Auth.ApiKeyCredential({ type: "api", key: "second-key" }),
          })
          expect(second).toBeDefined()
          if (!second) return
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "account", service: Auth.ServiceID.make("provider") },
              apiKey: "second-key",
            },
          ])

          updates.length = 0
          yield* accounts.activate(first.id)
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "account", service: Auth.ServiceID.make("provider") },
              apiKey: "first-key",
            },
          ])

          updates.length = 0
          yield* accounts.remove(first.id)
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([
            {
              id: ProviderV2.ID.make("provider"),
              enabled: { via: "account", service: Auth.ServiceID.make("provider") },
              apiKey: "second-key",
            },
          ])

          updates.length = 0
          yield* accounts.remove(second.id)
          yield* plugin.trigger("catalog.transform", context(records, updates), {})
          expect(updates).toEqual([])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )
})
