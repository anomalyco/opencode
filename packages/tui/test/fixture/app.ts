import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import path from "node:path"
import { Global } from "@opencode/util/global"
import type { TuiInput } from "../../src/app"
import type { Config } from "../../src/config"
import { tmpdir } from "./fixture"
import { createEventStream, createFetch, type FetchHandler } from "./tui-client"

export async function createAppFixture(
  input: {
    width?: number
    height?: number
    state?: string
    config?: Config.Info
    args?: TuiInput["args"]
    fetch?: FetchHandler
  } = {},
) {
  const { run } = await import("../../src/app")
  const root = await tmpdir()
  const setup = await createTestRenderer({
    width: input.width ?? 100,
    height: input.height ?? 30,
    useThread: false,
    kittyKeyboard: true,
  })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const events = createEventStream()
  const calls = createFetch(input.fetch, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => input.config ?? { animations: false }, update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
      args: input.args ?? {},
      log: () => {},
    }).pipe(
      Effect.provide(
        Global.layerWith({
          home: path.join(root.path, "home"),
          data: path.join(root.path, "data"),
          cache: path.join(root.path, "cache"),
          config: path.join(root.path, "config"),
          state: input.state ?? path.join(root.path, "state"),
          bin: path.join(root.path, "cache", "bin"),
          log: path.join(root.path, "data", "log"),
          repos: path.join(root.path, "data", "repos"),
          tmp: path.join(root.path, "tmp"),
        }),
      ),
      Effect.provide(FileSystem.layerNoop({})),
    ),
  )
  return {
    ...setup,
    events,
    ready: ready.promise,
    async [Symbol.asyncDispose]() {
      try {
        if (!setup.renderer.isDestroyed) setup.renderer.destroy()
        await task
      } finally {
        await server.stop()
        await root[Symbol.asyncDispose]()
      }
    },
  }
}
