import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigImagePlugin } from "@opencode/core/config/plugin/image"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Document, Event, Info, type Entry } from "@opencode/schema/config"
import { Effect, Layer, Schema, Stream } from "effect"
import { waitUntil } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(Layer.merge(PluginTestLayer, AppNodeBuilder.build(Image.node)))
const decode = Schema.decodeUnknownSync(Info)
const content = {
  uri: "file:///pixel.png",
  content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  encoding: "base64" as const,
  mime: "image/png",
}

describe("ConfigImagePlugin.Plugin", () => {
  it.live("merges image limits and reloads changed config", () =>
    Effect.gen(function* () {
      const image = yield* Image.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* ConfigImagePlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      expect(yield* limits(image)).toEqual({ maxWidth: 1_200, maxHeight: 900, maxBytes: 1 })

      yield* config.setEntries([document({ auto_resize: false, max_width: 700, max_base64_bytes: 1 })])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        limits(image).pipe(
          Effect.map((current) => current.maxWidth === 700 && current.maxHeight === 2_000 && current.maxBytes === 1),
        ),
      )
    }).pipe(
      Effect.provide(
        Config.testLayer([
          document({ auto_resize: false, max_width: 1_200 }),
          document({ max_height: 900, max_base64_bytes: 1 }),
        ]),
      ),
    ),
  )

  it.live("reads the config current when the image service reloads", () =>
    Effect.gen(function* () {
      const image = yield* Image.Service
      const plugins = yield* Plugin.Service
      const current = { width: 1_200 }
      const read = () => [document({ max_width: current.width, max_base64_bytes: 1 })]
      const config = Config.Service.of({
        entries: () => Effect.sync(read),
        snapshot: read,
        changes: () => Stream.empty,
      })
      yield* ConfigImagePlugin.Plugin.effect(yield* PluginHost.make(plugins, "test")).pipe(
        Effect.provideService(Config.Service, config),
      )
      expect(yield* limits(image)).toEqual({ maxWidth: 1_200, maxHeight: 2_000, maxBytes: 1 })

      // No `config.updated` yet: a reload for another reason already sees the change.
      current.width = 700
      yield* image.reload()
      expect(yield* limits(image)).toEqual({ maxWidth: 700, maxHeight: 2_000, maxBytes: 1 })
    }),
  )
})

function document(image: NonNullable<typeof Info.Encoded.media>["image"]): Entry {
  return new Document({ type: "document", info: decode({ media: { image } }) })
}

const limits = Effect.fnUntraced(function* (image: Image.Interface) {
  const error = yield* image.normalize("pixel.png", content).pipe(Effect.flip, Effect.orDie)
  if (error._tag !== "Image.SizeError") return yield* Effect.die(error)
  return { maxWidth: error.maxWidth, maxHeight: error.maxHeight, maxBytes: error.maxBytes }
})
