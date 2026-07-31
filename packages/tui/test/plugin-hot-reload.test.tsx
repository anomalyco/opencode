import { expect, mock, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { createEventStream, createFetch } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

function pluginSource(marker: string, version: string) {
  return `
import { writeFile } from "node:fs/promises"
export default {
  id: "test.hot",
  setup: async () => {
    await writeFile(${JSON.stringify(marker)}, ${JSON.stringify(version)})
  },
}
`
}

async function until(read: () => Promise<string>, expected: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read().catch(() => undefined)
    if (value === expected) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return read().catch(() => undefined)
}

test("editing a discovered TUI plugin hot-reloads its fresh module", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const marker = path.join(tmp.path, "marker.txt")
  const source = path.join(directory, "hot.ts")
  await writeFile(source, pluginSource(marker, "v1"))

  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const cwd = process.cwd()
  process.chdir(tmp.path)
  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({}), update: async () => ({}) },
        packages: { resolve: async () => undefined },
        args: {},
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )
    const read = () => readFile(marker, "utf8")
    expect(await until(read, "v1")).toBe("v1")

    await writeFile(source, pluginSource(marker, "v2"))
    expect(await until(read, "v2")).toBe("v2")

    process.emit("SIGHUP")
    await task
  } finally {
    process.chdir(cwd)
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
    mock.restore()
  }
})
