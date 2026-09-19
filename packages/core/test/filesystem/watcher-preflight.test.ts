import { $ } from "bun"
import { describe, expect } from "bun:test"
import os from "os"
import path from "path"
import { ConfigProvider, Effect, Layer, Logger } from "effect"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node, EventV2.node])))

const configLayer = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () => Effect.succeed([]),
  }),
)

const flagsLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "false",
  }),
)

const WARNING = "watcher unavailable, continuing without it"

// Builds the watcher against a real git directory with the native binding
// faked, so the only thing under test is what the preflight decides. The
// backend is pinned to inotify because that is the only platform where the
// kernel can refuse the resource.
function build(probe: () => ReturnType<NonNullable<Watcher.LayerOptions["probe"]>>) {
  return Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    yield* Effect.promise(() => $`git init`.cwd(tmp.path).quiet())

    const messages: unknown[] = []
    const directories: string[] = []

    yield* Effect.asVoid(Watcher.Service).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          Watcher.nodeWith({
            backend: "inotify",
            probe,
            watcher: () => ({
              subscribe: async (directory: string) => {
                directories.push(directory)
                return { unsubscribe: async () => {} }
              },
            }),
          }),
          [
            [Config.node, configLayer],
            [
              Location.node,
              Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(tmp.path) },
                    { vcs: { type: "git", store: AbsolutePath.make(path.join(tmp.path, ".git")) } },
                  ),
                ),
              ),
            ],
          ],
        ).pipe(Layer.provide(flagsLayer)),
      ),
      Effect.provide(
        Logger.layer([
          Logger.make<unknown, void>((options) => {
            messages.push(options.message)
          }),
        ]),
      ),
      Effect.scoped,
    )

    return { messages, directories }
  })
}

describe("Watcher preflight", () => {
  it.live("degrades to no watcher when the kernel refuses an inotify instance", () =>
    Effect.gen(function* () {
      const result = yield* build(() => ({ errno: os.constants.errno.EMFILE, code: "EMFILE" }))

      // Reaching any assertion at all is the regression: the layer settled
      // instead of parking the thread that asked for the instance.
      expect(result.directories).toEqual([])
      expect(result.messages.filter((item) => Array.isArray(item) && item[0] === WARNING)).toEqual([
        [
          WARNING,
          expect.objectContaining({
            backend: "inotify",
            errno: os.constants.errno.EMFILE,
            code: "EMFILE",
          }),
        ],
      ])
    }),
  )

  it.live("subscribes as usual when an inotify instance is available", () =>
    Effect.gen(function* () {
      const result = yield* build(() => undefined)

      expect(result.directories.length).toBeGreaterThan(0)
      expect(result.messages.filter((item) => Array.isArray(item) && item[0] === WARNING)).toEqual([])
    }),
  )
})
