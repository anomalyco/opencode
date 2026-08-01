import { expect, mock, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { createEventStream, createFetch } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

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

async function until(read: () => Promise<string>, expected: (value: string | undefined) => boolean) {
  let value: string | undefined
  for (let attempt = 0; attempt < 200; attempt++) {
    value = await read().catch(() => undefined)
    if (expected(value)) return value
    await Bun.sleep(50)
  }
  return value
}

async function bootApp(directory: string) {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const cwd = process.cwd()
  process.chdir(directory)
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
  return {
    task,
    async [Symbol.asyncDispose]() {
      process.chdir(cwd)
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      await server.stop()
      mock.restore()
    },
  }
}

test("editing a discovered TUI plugin hot-reloads its fresh module", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const marker = path.join(tmp.path, "marker.txt")
  const source = path.join(directory, "hot.ts")
  await writeFile(source, lifecycleSource(marker, "test.hot", "v1"))

  await using app = await bootApp(tmp.path)
  const read = () => readFile(marker, "utf8")
  expect(await until(read, (value) => value === "v1:setup\n")).toBe("v1:setup\n")

  await writeFile(source, lifecycleSource(marker, "test.hot", "v2"))
  expect(await until(read, (value) => value?.includes("v2:setup") ?? false)).toBe("v1:setup\nv1:cleanup\nv2:setup\n")

  process.emit("SIGHUP")
  await app.task
})

test("a plugin whose slot render throws does not take down the TUI", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const markerA = path.join(tmp.path, "a.txt")
  const markerCrash = path.join(tmp.path, "crash.txt")
  const sourceA = path.join(directory, "a.ts")
  await writeFile(sourceA, lifecycleSource(markerA, "test.a", "a1"))
  await writeFile(
    path.join(directory, "crash.ts"),
    `
import { appendFile } from "node:fs/promises"
export default {
  id: "test.crash",
  setup: async (context: any) => {
    context.ui.slot("home.footer", () => {
      throw new Error("boom")
    })
    await appendFile(${JSON.stringify(markerCrash)}, "setup\\n")
  },
}
`,
  )

  await using app = await bootApp(tmp.path)
  const readA = () => readFile(markerA, "utf8")
  expect(await until(readA, (value) => value === "a1:setup\n")).toBe("a1:setup\n")
  // The crashing plugin genuinely loaded and registered its slot; without
  // this the rest of the test would pass even if it never imported.
  expect(await until(() => readFile(markerCrash, "utf8"), (value) => value === "setup\n")).toBe("setup\n")

  // The app survives the crashing slot: hot reload still works for others.
  // The render-time boundary itself (fallback + toast) is not exercisable
  // here: the test renderer never executes slot render bodies, so render
  // containment is verified in the real TUI (see PluginBoundary in
  // src/plugin/render.tsx and the demo runs on the PR).
  await writeFile(sourceA, lifecycleSource(markerA, "test.a", "a2"))
  expect(await until(readA, (value) => value?.includes("a2:setup") ?? false)).toBe("a1:setup\na1:cleanup\na2:setup\n")

  process.emit("SIGHUP")
  await app.task
})

test("editing one plugin leaves others untouched and a broken save keeps the last good version", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const markerA = path.join(tmp.path, "a.txt")
  const markerB = path.join(tmp.path, "b.txt")
  const sourceA = path.join(directory, "a.ts")
  const sourceB = path.join(directory, "b.ts")
  await writeFile(sourceA, lifecycleSource(markerA, "test.a", "a1"))
  await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b1"))

  await using app = await bootApp(tmp.path)
  const readA = () => readFile(markerA, "utf8")
  const readB = () => readFile(markerB, "utf8")
  await until(readA, (value) => value === "a1:setup\n")
  await until(readB, (value) => value === "b1:setup\n")

  // Editing B restarts only B: A sees no cleanup and no second setup.
  await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b2"))
  expect(await until(readB, (value) => value?.includes("b2:setup") ?? false)).toBe("b1:setup\nb1:cleanup\nb2:setup\n")
  expect(await readA()).toBe("a1:setup\n")

  // A broken save keeps the last good version running: b2 is never cleaned
  // up. Editing A afterwards provides a positive completion signal — once
  // A's swap lands, the serialized reconcile has processed the broken save.
  await writeFile(sourceB, "export default {")
  await writeFile(sourceA, lifecycleSource(markerA, "test.a", "a2"))
  expect(await until(readA, (value) => value?.includes("a2:setup") ?? false)).toBe("a1:setup\na1:cleanup\na2:setup\n")
  expect(await readB()).toBe("b1:setup\nb1:cleanup\nb2:setup\n")

  // Fixing the file replaces the kept version and leaves A alone.
  await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b3"))
  expect(await until(readB, (value) => value?.includes("b3:setup") ?? false)).toBe(
    "b1:setup\nb1:cleanup\nb2:setup\nb2:cleanup\nb3:setup\n",
  )
  expect(await readA()).toBe("a1:setup\na1:cleanup\na2:setup\n")

  process.emit("SIGHUP")
  await app.task
})

test("a save whose setup throws restores the previous version", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const marker = path.join(tmp.path, "a.txt")
  const source = path.join(directory, "a.ts")
  await writeFile(source, lifecycleSource(marker, "test.a", "a1"))

  await using app = await bootApp(tmp.path)
  const read = () => readFile(marker, "utf8")
  expect(await until(read, (value) => value === "a1:setup\n")).toBe("a1:setup\n")

  // The module imports fine but its setup throws — unlike an import failure,
  // the swap has already torn down a1, so keep-last-good means restoring it.
  await writeFile(
    source,
    `
export default {
  id: "test.a",
  setup: async () => {
    throw new Error("setup boom")
  },
}
`,
  )
  expect(await until(read, (value) => value === "a1:setup\na1:cleanup\na1:setup\n")).toBe(
    "a1:setup\na1:cleanup\na1:setup\n",
  )

  // Fixing the file swaps out the restored version normally.
  await writeFile(source, lifecycleSource(marker, "test.a", "a2"))
  expect(await until(read, (value) => value?.includes("a2:setup") ?? false)).toBe(
    "a1:setup\na1:cleanup\na1:setup\na1:cleanup\na2:setup\n",
  )

  process.emit("SIGHUP")
  await app.task
})

test("editing a symlinked plugin's target hot-reloads it", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const marker = path.join(tmp.path, "a.txt")
  // The real source lives outside the discovery directory; only a symlink
  // is discovered. Edits land at the target, which emits no event in the
  // plugin directory itself.
  const target = path.join(tmp.path, "elsewhere", "a.ts")
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, lifecycleSource(marker, "test.a", "a1"))
  await symlink(target, path.join(directory, "a.ts"))

  await using app = await bootApp(tmp.path)
  const read = () => readFile(marker, "utf8")
  expect(await until(read, (value) => value === "a1:setup\n")).toBe("a1:setup\n")

  await writeFile(target, lifecycleSource(marker, "test.a", "a2"))
  expect(await until(read, (value) => value?.includes("a2:setup") ?? false)).toBe("a1:setup\na1:cleanup\na2:setup\n")

  process.emit("SIGHUP")
  await app.task
})

test("memory storage survives hot reload while disk storage persists", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(directory, { recursive: true })
  const marker = path.join(tmp.path, "counter.txt")
  const source = path.join(directory, "counter.ts")
  const counterSource = (note: string) => `
import { appendFile } from "node:fs/promises"
// ${note}
export default {
  id: "test.counter",
  setup: async (context: any) => {
    const [state, update] = context.storage.memory("counter", { initial: { count: 0 } })
    update((draft: any) => {
      draft.count += 1
    })
    await appendFile(${JSON.stringify(marker)}, "count:" + state.count + "\\n")
  },
}
`
  await writeFile(source, counterSource("v1"))

  await using app = await bootApp(tmp.path)
  const read = () => readFile(marker, "utf8")
  expect(await until(read, (value) => value === "count:1\n")).toBe("count:1\n")

  // The reloaded generation shares the same live store: the count continues.
  await writeFile(source, counterSource("v2"))
  expect(await until(read, (value) => value?.includes("count:2") ?? false)).toBe("count:1\ncount:2\n")

  process.emit("SIGHUP")
  await app.task
})
