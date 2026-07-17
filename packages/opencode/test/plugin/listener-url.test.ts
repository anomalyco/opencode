import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin/index"
import { Server } from "@/server/server"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])), testInstanceStoreLayer),
)

describe("plugin listener URL", () => {
  it.live("tracks the actual listener lifecycle on one captured plugin input", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const file = path.join(directory, "listener-plugin.ts")
      const spec = pathToFileURL(file).href
      const source = path.join(directory, "opencode.json")
      yield* Effect.promise(() =>
        Bun.write(
          file,
          [
            "export default async function plugin(input) {",
            "  return {",
            '    "shell.env": async (_input, output) => {',
            '      output.env.LISTENER_URL = input.listenerUrl?.href ?? "undefined"',
            "      output.env.SERVER_URL = input.serverUrl.href",
            "    },",
            "  }",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const program = Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.init()
        const observe = () =>
          Effect.gen(function* () {
            const output = { env: {} }
            yield* plugin.trigger("shell.env", { cwd: directory }, output)
            return output.env
          })

        expect(yield* observe()).toEqual({
          LISTENER_URL: "undefined",
          SERVER_URL: "http://localhost:4096/",
        })

        yield* Effect.acquireUseRelease(
          Effect.promise(() => Server.listen({ hostname: "127.0.0.1", port: 0 })),
          (listener) =>
            Effect.gen(function* () {
              expect(yield* observe()).toEqual({
                LISTENER_URL: listener.url.href,
                SERVER_URL: listener.url.href,
              })
            }),
          (listener) => Effect.promise(() => listener.stop(true)),
        )

        expect(yield* observe()).toEqual({
          LISTENER_URL: "undefined",
          SERVER_URL: "http://localhost:4096/",
        })

        yield* Effect.acquireUseRelease(
          Effect.promise(() => Server.listen({ hostname: "localhost", port: 0 })),
          (listener) =>
            Effect.gen(function* () {
              expect(yield* observe()).toEqual({
                LISTENER_URL: listener.url.href,
                SERVER_URL: listener.url.href,
              })
            }),
          (listener) => Effect.promise(() => listener.stop(true)),
        )

        expect(yield* observe()).toEqual({
          LISTENER_URL: "undefined",
          SERVER_URL: "http://localhost:4096/",
        })
      })

      yield* program.pipe(
        Effect.provide(
          LayerNode.compile(Plugin.node, [
            [
              Config.node,
              TestConfig.layer({
                get: () =>
                  Effect.succeed({
                    plugin: [spec],
                    plugin_origins: [{ spec, source, scope: "local" as const }],
                  }),
                directories: () => Effect.succeed([directory]),
              }),
            ],
            [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
          ]),
        ),
        provideInstance(directory),
      )
    }),
  )
})
