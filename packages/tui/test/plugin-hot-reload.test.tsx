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

async function until(read: () => Promise<string>, expected: (value: string | undefined) => boolean) {
  let value: string | undefined
  for (let attempt = 0; attempt < 200; attempt++) {
    value = await read().catch(() => undefined)
    if (expected(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return value
}

function lifecycleSource(marker: string, id: string, version: string) {
  return `
import { appendFile } from "node:fs/promises"
export default {
  id: ${JSON.stringify(id)},
  setup: async () => {
    await appendFile(${JSON.stringify(marker)}, "${version}:setup\\n")
    return () => appendFile(${JSON.stringify(marker)}, "${version}:cleanup\\n")
  },
}
`
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
    expect(await until(read, (value) => value === "v1")).toBe("v1")

    await writeFile(source, pluginSource(marker, "v2"))
    expect(await until(read, (value) => value === "v2")).toBe("v2")

    process.emit("SIGHUP")
    await task
  } finally {
    process.chdir(cwd)
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
    mock.restore()
  }
})

test("editing one plugin leaves others untouched and a broken save keeps the last good version", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const markerA = path.join(tmp.path, "a.txt")
  const markerB = path.join(tmp.path, "b.txt")
  const sourceB = path.join(directory, "b.ts")
  await writeFile(path.join(directory, "a.ts"), lifecycleSource(markerA, "test.a", "a1"))
  await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b1"))

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
    const readA = () => readFile(markerA, "utf8")
    const readB = () => readFile(markerB, "utf8")
    await until(readA, (value) => value === "a1:setup\n")
    await until(readB, (value) => value === "b1:setup\n")

    // Editing B restarts only B: A sees no cleanup and no second setup.
    await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b2"))
    expect(await until(readB, (value) => value?.includes("b2:setup") ?? false)).toBe("b1:setup\nb1:cleanup\nb2:setup\n")
    expect(await readA()).toBe("a1:setup\n")

    // A broken save keeps the last good version running: b2 is never cleaned up.
    await writeFile(sourceB, "export default {")
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(await readB()).toBe("b1:setup\nb1:cleanup\nb2:setup\n")
    expect(await readA()).toBe("a1:setup\n")

    // Fixing the file replaces the kept version.
    await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b3"))
    expect(await until(readB, (value) => value?.includes("b3:setup") ?? false)).toBe(
      "b1:setup\nb1:cleanup\nb2:setup\nb2:cleanup\nb3:setup\n",
    )
    expect(await readA()).toBe("a1:setup\n")

    process.emit("SIGHUP")
    await task
  } finally {
    process.chdir(cwd)
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
    mock.restore()
  }
})
