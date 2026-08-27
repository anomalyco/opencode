import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ConfigReferencePlugin } from "@opencode-ai/core/config/plugin/reference"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { Reference } from "@opencode-ai/core/reference"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { Document, Info } from "@opencode-ai/schema/config"
import { Global } from "@opencode-ai/util/global"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const decode = Schema.decodeUnknownSync(Info)
const it = testEffect(PluginTestLayer)
const referenceLayer = AppNodeBuilder.build(Reference.node, [
  [RepositoryCache.node, Layer.mock(RepositoryCache.Service, { ensure: () => Effect.never })],
])

describe("config references", () => {
  test("decodes Git refresh intervals as durations", () => {
    const reference = decode({
      references: { effect: { repository: "Effect-TS/effect", refresh: "15 minutes" } },
    }).references?.effect

    expect(typeof reference).toBe("object")
    if (typeof reference !== "object" || !reference || !("repository" in reference)) return
    expect(reference.refresh).toEqual(Duration.minutes(15))
  })

  it.effect("converts Git refresh intervals across config and plugin boundaries", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const references = yield* Reference.Service
      const host = yield* PluginHost.make(plugin)
      yield* ConfigReferencePlugin.Plugin.effect(host)

      const reference = (yield* references.list()).find((entry) => entry.name === "effect")
      if (!reference || reference.source.type !== "git") throw new Error("expected configured Git reference")
      expect(reference.source.refresh).toEqual(Duration.minutes(15))

      yield* host.reference.transform((draft) => {
        expect(draft.list()).toContainEqual([
          "effect",
          { type: "git", repository: "Effect-TS/effect", refresh: "900000 millis" },
        ])
      })
    }).pipe(
      Effect.provide(referenceLayer),
      Effect.provide(
        Config.testLayer([
          new Document({
            type: "document",
            info: decode({
              references: { effect: { repository: "Effect-TS/effect", refresh: "15 minutes" } },
            }),
          }),
        ]),
      ),
      Effect.provideService(Global.Service, Global.Service.of(Global.make())),
    ),
  )
})
