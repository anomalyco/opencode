import path from "path"
import { describe, expect } from "bun:test"
import { produce } from "immer"
import { Effect, Layer, Option } from "effect"
import { AccountV2 } from "@opencode-ai/core/account"
import { Catalog } from "@opencode-ai/core/catalog"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AccountPlugin } from "@opencode-ai/core/plugin/account"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(PluginV2.defaultLayer)

function testLayer(dir: string) {
  return AccountV2.layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
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

describe("AccountV2", () => {
  it.live("runs account lifecycle hooks", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const accounts = yield* AccountV2.Service
          const plugin = yield* PluginV2.Service
          let blocked: AccountV2.ID | undefined

          yield* plugin.add({
            id: PluginV2.ID.make("test.account"),
            effect: Effect.succeed({
              "account.update": (evt) =>
                Effect.gen(function* () {
                  if (evt.description === "cancel") {
                    evt.cancel = true
                    return
                  }
                  const existing = yield* accounts.get(evt.id).pipe(Effect.orDie)
                  evt.description = existing ? `${evt.description}:updated` : `created:${evt.serviceID}`
                  if (evt.credential.type === "api") evt.credential.key = existing ? "updated-key" : "created-key"
                }),
              "account.remove": (evt) =>
                Effect.sync(() => {
                  if (evt.account.description.includes("keep")) evt.cancel = true
                }),
              "account.activate": (evt) =>
                Effect.sync(() => {
                  if (blocked && evt.to === blocked) evt.cancel = true
                }),
            }),
          })

          const first = yield* accounts.create({
            serviceID: AccountV2.ServiceID.make("provider"),
            credential: new AccountV2.ApiKeyCredential({ type: "api", key: "raw-key" }),
          })
          expect(first).toBeDefined()
          if (!first) return
          expect(first.description).toBe("created:provider")
          expect(first.credential.type).toBe("api")
          if (first.credential.type === "api") expect(first.credential.key).toBe("created-key")

          yield* accounts.update(first.id, { description: "keep" })
          const updated = yield* accounts.get(first.id)
          expect(updated?.description).toBe("keep:updated")
          expect(updated?.credential.type).toBe("api")
          if (updated?.credential.type === "api") expect(updated.credential.key).toBe("updated-key")

          yield* accounts.update(first.id, { description: "cancel" })
          expect((yield* accounts.get(first.id))?.description).toBe("keep:updated")

          const cancelled = yield* accounts.create({
            serviceID: AccountV2.ServiceID.make("provider"),
            credential: new AccountV2.ApiKeyCredential({ type: "api", key: "cancel-key" }),
            description: "cancel",
          })
          expect(cancelled).toBeUndefined()

          yield* accounts.remove(first.id)
          expect(yield* accounts.get(first.id)).toBeDefined()

          const second = yield* accounts.create({
            serviceID: AccountV2.ServiceID.make("provider"),
            credential: new AccountV2.ApiKeyCredential({ type: "api", key: "second-key" }),
            active: false,
          })
          expect(second).toBeDefined()
          if (!second) return
          blocked = second.id
          yield* accounts.activate(second.id)
          expect((yield* accounts.active(AccountV2.ServiceID.make("provider")))?.id).toBe(first.id)
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("account plugin refreshes providers on activation", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const accounts = yield* AccountV2.Service
          const plugin = yield* PluginV2.Service
          const updates: Array<{ id: ProviderV2.ID; enabled: ProviderV2.Info["enabled"]; apiKey?: string }> = []
          const catalog = Catalog.Service.of({
            provider: {
              get: () => Effect.die("unexpected provider.get"),
              update: (providerID, fn) =>
                Effect.sync(() => {
                  const provider = produce(ProviderV2.Info.empty(providerID), fn)
                  updates.push({
                    id: providerID,
                    enabled: provider.enabled,
                    apiKey:
                      typeof provider.options.aisdk.provider.apiKey === "string"
                        ? provider.options.aisdk.provider.apiKey
                        : undefined,
                  })
                }),
              all: () => Effect.succeed([]),
              available: () => Effect.succeed([]),
            },
            model: {
              get: () => Effect.die("unexpected model.get"),
              update: () => Effect.die("unexpected model.update"),
              all: () => Effect.succeed([]),
              available: () => Effect.succeed([]),
              default: () => Effect.succeed(Option.none<ModelV2.Info>()),
              setDefault: () => Effect.die("unexpected model.setDefault"),
              small: () => Effect.succeed(Option.none<ModelV2.Info>()),
            },
          })

          yield* plugin.add({
            ...AccountPlugin,
            effect: AccountPlugin.effect.pipe(
              Effect.provideService(AccountV2.Service, accounts),
              Effect.provideService(Catalog.Service, catalog),
            ),
          })

          const previous = yield* accounts.create({
            serviceID: AccountV2.ServiceID.make("old-provider"),
            credential: new AccountV2.ApiKeyCredential({ type: "api", key: "old-key" }),
          })
          const next = yield* accounts.create({
            serviceID: AccountV2.ServiceID.make("new-provider"),
            credential: new AccountV2.ApiKeyCredential({ type: "api", key: "new-key" }),
            active: false,
          })
          expect(previous).toBeDefined()
          expect(next).toBeDefined()
          if (!previous || !next) return

          yield* plugin.trigger("account.activated", { from: previous.id, to: next.id }, {})

          expect(updates).toEqual([
            { id: ProviderV2.ID.make("old-provider"), enabled: false, apiKey: undefined },
            {
              id: ProviderV2.ID.make("new-provider"),
              enabled: { via: "account", service: AccountV2.ServiceID.make("new-provider") },
              apiKey: "new-key",
            },
          ])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )
})
