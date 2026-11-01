import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Bus } from "@opencode/core/bus"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Event } from "@opencode/schema/model"
import { Effect, Fiber, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("lists other model types for plugins only when they ask for them", () =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const plugins = yield* Plugin.Service
    const catalog = yield* Provider.Service
    yield* agents.transform((editor) => editor.update(Agent.ID.make("build"), () => {}))
    const host = yield* PluginHost.make(plugins)
    const imageID = Model.ID.make("meta/muse-spark-1.1")
    yield* catalog.transform((editor) => {
      editor.models.update(Provider.ID.make("test"), imageID, (model) => {
        model.type = "image"
      })
    })
    const ids = (models: readonly Model.Info[]) => models.map((model) => model.id)

    const chat = ids((yield* host.model.list()).data)
    expect(chat).not.toContain(imageID)
    expect(ids((yield* host.model.list({ types: [] })).data)).toEqual(chat)
    expect(ids((yield* host.model.list({ types: ["image"] })).data)).toEqual([imageID])
    expect(ids((yield* host.model.list({ types: ["chat", "image"] })).data)).toEqual([...chat, imageID])
  }),
)

it.effect("reruns model transforms on a provider reload and publishes only real changes", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const catalog = yield* Provider.Service
    const models = yield* Model.Service
    const bus = yield* Bus.Service
    const host = yield* PluginHost.make(plugins)
    const providerID = Provider.ID.make("test")
    const modelID = Model.ID.make("chat")
    yield* catalog.transform((editor) => {
      editor.update(providerID, () => {})
      editor.models.update(providerID, modelID, () => {})
    })
    let name = "Chat"
    yield* host.model.transform((editor) =>
      editor.update(providerID, modelID, (model) => {
        model.name = name
      }),
    )
    yield* models.all()
    const first = yield* bus
      .subscribe([Provider.Event.Updated, Event.Updated])
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))

    yield* host.provider.reload()
    // Anything published by the reload would arrive before this marker.
    const marker = yield* bus.publish(Event.Updated, {})
    expect((yield* Fiber.join(first))[0]?.id).toBe(marker.id)

    const updated = yield* bus
      .subscribe([Provider.Event.Updated, Event.Updated])
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
    name = "Renamed"
    yield* host.provider.reload()
    expect((yield* Fiber.join(updated))[0]?.type).toBe("model.updated")
    expect((yield* models.get(providerID, modelID))?.name).toBe("Renamed")
  }),
)
