import { afterEach, expect, spyOn, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiPluginRuntime } from "../../../src/cli/cmd/tui/plugin/runtime"
import { tui, type TuiHandle } from "../../../src/cli/cmd/tui/app"
import { Global } from "@opencode-ai/core/global"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"
import * as TuiAudio from "../../../src/cli/cmd/tui/util/audio"
import * as TuiKeymap from "../../../src/cli/cmd/tui/keymap"

type TestRendererSetup = Awaited<ReturnType<typeof createTestRenderer>>
type TmpDir = Awaited<ReturnType<typeof tmpdir>>

const disabledInternalPlugins = {
  "internal:home-footer": false,
  "internal:home-tips": false,
  "internal:sidebar-context": false,
  "internal:sidebar-mcp": false,
  "internal:sidebar-lsp": false,
  "internal:sidebar-todo": false,
  "internal:sidebar-files": false,
  "internal:sidebar-footer": false,
  "internal:plugin-manager": false,
  "internal:session-v2-debug": false,
  "which-key": false,
}
let active: { handle?: TuiHandle; setup?: TestRendererSetup; restore?: () => void; tmp?: TmpDir } | undefined

afterEach(async () => {
  const current = active
  active = undefined
  await current?.handle?.exit().catch(() => {})
  await current?.handle?.done.catch(() => {})
  await current?.handle?.ready.catch(() => {})
  if (current?.setup && !current.setup.renderer.isDestroyed) current.setup.renderer.destroy()
  current?.restore?.()
  await Bun.sleep(20)
  await current?.tmp?.[Symbol.asyncDispose]()
  await TuiPluginRuntime.dispose().catch(() => {})
})

test("returns a handle immediately and resolves ready after async mount setup", async () => {
  const app = await startTui()

  expect(await promiseState(app.handle.ready)).toBe("pending")

  app.theme.resolve("dark")
  await app.handle.ready

  expect(app.setup.renderer.isDestroyed).toBe(false)
  expect(await promiseState(app.handle.done)).toBe("pending")
})

test("production can await done only and still receives mount failures", async () => {
  const app = await startTui({ rejectTheme: new Error("theme failed") })

  await expect(app.handle.done).rejects.toThrow("theme failed")
  expect(app.setup.renderer.isDestroyed).toBe(true)
})

test("exit destroys the renderer, resolves done, and runs cleanup once", async () => {
  const beforeSighup = process.listenerCount("SIGHUP")
  const app = await startTui()

  app.theme.resolve("dark")
  await app.handle.ready
  expect(process.listenerCount("SIGHUP")).toBeGreaterThan(beforeSighup)

  await Promise.all([app.handle.exit(), app.handle.exit()])
  await app.handle.done

  expect(app.setup.renderer.isDestroyed).toBe(true)
  expect(process.listenerCount("SIGHUP")).toBe(beforeSighup)
})

test("exit preserves reason formatting and exit messages", async () => {
  const stdout: string[] = []
  const stderr: string[] = []
  const stdoutWrite = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk))
    return true
  })
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk))
    return true
  })

  try {
    const app = await startTui()
    app.theme.resolve("dark")
    await app.handle.ready

    app.handle.exit.message.set("goodbye")
    await app.handle.exit(new Error("boom"))
    await app.handle.done

    expect(stderr.join("")).toContain("boom")
    expect(stdout.join("")).toBe("goodbye\n")
  } finally {
    stdoutWrite.mockRestore()
    stderrWrite.mockRestore()
  }
})

test("exit before ready cancels mount and resolves done", async () => {
  const app = await startTui()

  await app.handle.exit()
  await app.handle.done

  expect(app.setup.renderer.isDestroyed).toBe(true)
  await expect(app.handle.ready).resolves.toBeUndefined()
})

test("direct renderer destruction still cleans up and resolves done", async () => {
  const beforeSighup = process.listenerCount("SIGHUP")
  const app = await startTui()

  app.theme.resolve("dark")
  await app.handle.ready
  app.setup.renderer.destroy()
  await app.handle.done

  expect(process.listenerCount("SIGHUP")).toBe(beforeSighup)
})

test("SIGHUP exits before ready and removes its listener", async () => {
  const beforeSighup = process.listenerCount("SIGHUP")
  const app = await startTui()

  process.emit("SIGHUP")
  await app.handle.done

  expect(app.setup.renderer.isDestroyed).toBe(true)
  expect(process.listenerCount("SIGHUP")).toBe(beforeSighup)
})

test("SIGHUP exits after ready and removes its listener", async () => {
  const beforeSighup = process.listenerCount("SIGHUP")
  const app = await startTui()

  app.theme.resolve("dark")
  await app.handle.ready
  process.emit("SIGHUP")
  await app.handle.done

  expect(app.setup.renderer.isDestroyed).toBe(true)
  expect(process.listenerCount("SIGHUP")).toBe(beforeSighup)
})

test("plugin, audio, and keymap cleanup run exactly once", async () => {
  const originalRegister = TuiKeymap.registerOpencodeKeymap
  let unregisterKeymapCalls = 0
  const registerKeymap = spyOn(TuiKeymap, "registerOpencodeKeymap").mockImplementation((...args) => {
    const unregister = originalRegister(...args)
    return () => {
      unregisterKeymapCalls++
      unregister()
    }
  })
  const disposePlugins = spyOn(TuiPluginRuntime, "dispose")
  const disposeAudio = spyOn(TuiAudio, "dispose")

  try {
    const app = await startTui()
    app.theme.resolve("dark")
    await app.handle.ready

    app.setup.renderer.destroy()
    await Promise.all([app.handle.exit(), app.handle.exit()])
    await app.handle.done

    expect(registerKeymap).toHaveBeenCalledTimes(1)
    expect(unregisterKeymapCalls).toBe(1)
    expect(disposePlugins).toHaveBeenCalledTimes(1)
    expect(disposeAudio).toHaveBeenCalledTimes(1)
  } finally {
    registerKeymap.mockRestore()
    disposePlugins.mockRestore()
    disposeAudio.mockRestore()
  }
})

async function startTui(options: { rejectTheme?: Error } = {}) {
  const tmp = await tmpdir()
  const restore = await isolateGlobalPaths(tmp.path)
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false, maxFps: Number.POSITIVE_INFINITY })
  const theme = deferred<"dark" | "light" | null>()
  const waitForThemeMode = spyOn(setup.renderer, "waitForThemeMode").mockImplementation(() => {
    if (options.rejectTheme) return Promise.reject(options.rejectTheme)
    return theme.promise
  })
  setup.renderer.once("destroy", () => theme.resolve(null))

  const calls = createFetch()
  const events = createEventSource()
  const handle = tui({
    url: "http://test",
    renderer: setup.renderer,
    config: createTuiResolvedConfig({ plugin_enabled: disabledInternalPlugins }),
    directory,
    fetch: calls.fetch,
    events: events.source,
    args: {},
  })
  active = {
    handle,
    setup,
    tmp,
    restore: () => {
      waitForThemeMode.mockRestore()
      restore()
    },
  }

  return { handle, setup, theme }
}

async function isolateGlobalPaths(root: string) {
  const previous = {
    config: Global.Path.config,
    state: Global.Path.state,
  }
  Global.Path.config = path.join(root, "config")
  Global.Path.state = path.join(root, "state")
  await mkdir(Global.Path.config, { recursive: true })
  await mkdir(Global.Path.state, { recursive: true })
  await Bun.write(path.join(Global.Path.state, "kv.json"), JSON.stringify({ animations_enabled: false }))

  return () => {
    Global.Path.config = previous.config
    Global.Path.state = previous.state
  }
}

async function promiseState(promise: Promise<unknown>) {
  let state: "pending" | "resolved" | "rejected" = "pending"
  promise.then(
    () => {
      state = "resolved"
    },
    () => {
      state = "rejected"
    },
  )
  await Promise.resolve()
  return state
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
