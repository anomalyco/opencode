import { beforeAll, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { join } from "node:path"

import type { SqliteMigrationProgress } from "../preload/types"

type ServerModule = typeof import("./server")

class FakeSidecar extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly postedMessages: unknown[] = []
  killed = false

  postMessage(message: unknown): void {
    this.postedMessages.push(message)
  }

  kill(): void {
    this.killed = true
    this.emit("exit", 143)
  }

  emitMessage(message: unknown): void {
    this.emit("message", message)
  }

  emitExit(code: number): void {
    this.emit("exit", code)
  }
}

type HarnessOptions = {
  startStallTimeout?: number
  checkHealth?: (url: string, password?: string | null) => Promise<boolean>
  delay?: (ms: number) => Promise<void>
}

let serverModule: ServerModule | undefined

function module(): ServerModule {
  if (!serverModule) throw new Error("server module was not loaded")
  return serverModule
}

function createHarness(options: HarnessOptions = {}) {
  const child = new FakeSidecar()
  const app = new EventEmitter()
  const spawnLocalServer = module().createSpawnLocalServer({
    app,
    forkSidecar: () => child,
    makeDirectory: async () => undefined,
    sidecarPath: "/tmp/sidecar.js",
    checkHealth: options.checkHealth ?? (async () => true),
    delay: options.delay ?? ((ms) => Bun.sleep(ms)),
    startStallTimeout: options.startStallTimeout ?? 100,
    stopTimeout: 25,
  })

  const start = () =>
    spawnLocalServer("127.0.0.1", 4096, "secret", {
      needsMigration: true,
      userDataPath: "/tmp/opencode-user-data",
    })

  return { app, child, spawnLocalServer, start }
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    return new Error(String(error))
  }
  throw new Error("expected promise to reject")
}

beforeAll(async () => {
  mock.module("electron", () => ({
    app: {
      on: () => undefined,
      off: () => undefined,
      getPath: () => "/tmp/opencode-user-data",
    },
    utilityProcess: {
      fork: () => {
        throw new Error("default utilityProcess.fork should not run in server tests")
      },
    },
  }))
  mock.module("./shell-env", () => ({
    getUserShell: () => "/bin/sh",
    loadShellEnv: () => null,
  }))
  mock.module("./store", () => ({
    getStore: () => ({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  }))
  serverModule = await import("./server")
})

describe("spawnLocalServer", () => {
  test("rejects startup when the sidecar reports an error before ready", async () => {
    const { child, start } = createHarness()
    const started = start()

    await Bun.sleep(0)
    child.emitMessage({
      type: "error",
      error: { message: "migration failed", stack: "Error: migration failed\n    at sidecar" },
    })

    const error = await rejection(started)

    expect(error.message).toBe("migration failed")
    expect(error.stack).toContain("sidecar")
    expect(child.killed).toBe(true)
  })

  test("rejects startup when the sidecar exits before ready", async () => {
    const { child, spawnLocalServer } = createHarness()
    const exitCodes: number[] = []
    const started = spawnLocalServer("127.0.0.1", 4096, "secret", {
      needsMigration: false,
      userDataPath: "/tmp/opencode-user-data",
      onExit: (code) => exitCodes.push(code),
    })

    await Bun.sleep(0)
    child.emitExit(2)
    const error = await rejection(started)

    expect(error.message).toBe("Sidecar exited before ready with code 2")
    expect(exitCodes).toEqual([2])
    expect(child.killed).toBe(false)
  })

  test("forwards sqlite progress and keeps startup alive while waiting for ready", async () => {
    const progress: SqliteMigrationProgress[] = []
    const { child, spawnLocalServer } = createHarness({ startStallTimeout: 150 })
    const started = spawnLocalServer("127.0.0.1", 4096, "secret", {
      needsMigration: true,
      userDataPath: "/tmp/opencode-user-data",
      onSqliteProgress: (item) => progress.push(item),
    })

    await Bun.sleep(40)
    child.emitMessage({ type: "sqlite", progress: { type: "InProgress", value: 50 } })
    await Bun.sleep(130)
    child.emitMessage({ type: "ready" })
    const result = await started

    expect(progress).toEqual([{ type: "InProgress", value: 50 }])
    expect(result.listener).toBeDefined()
    expect(child.killed).toBe(false)
  })

  test("calls onUnexpectedExit after ready and health success", async () => {
    const unexpectedCodes: number[] = []
    const healthUrls: string[] = []
    const { child, spawnLocalServer } = createHarness({
      checkHealth: async (url) => {
        healthUrls.push(url)
        return true
      },
    })
    const started = spawnLocalServer("127.0.0.1", 4096, "secret", {
      needsMigration: false,
      userDataPath: "/tmp/opencode-user-data",
      onUnexpectedExit: (code) => unexpectedCodes.push(code),
    })

    await Bun.sleep(0)
    child.emitMessage({ type: "ready" })
    const result = await started
    await result.health.wait
    child.emitExit(7)

    expect(healthUrls).toEqual(["http://127.0.0.1:4096"])
    expect(unexpectedCodes).toEqual([7])
  })

  test("does not call onUnexpectedExit when stop is expected", async () => {
    const unexpectedCodes: number[] = []
    const { child, spawnLocalServer } = createHarness()
    const started = spawnLocalServer("127.0.0.1", 4096, "secret", {
      needsMigration: false,
      userDataPath: "/tmp/opencode-user-data",
      onUnexpectedExit: (code) => unexpectedCodes.push(code),
    })

    await Bun.sleep(0)
    child.emitMessage({ type: "ready" })
    const result = await started
    await result.health.wait
    const stopping = result.listener.stop()
    child.emitExit(0)
    await stopping

    expect(child.postedMessages).toContainEqual({ type: "stop" })
    expect(unexpectedCodes).toEqual([])
  })

  test("starts the sidecar in the app-private default workspace", async () => {
    let cwd = ""
    const child = new FakeSidecar()
    const spawnLocalServer = module().createSpawnLocalServer({
      app: new EventEmitter(),
      forkSidecar: (_sidecar, sidecarCwd) => {
        cwd = sidecarCwd
        return child
      },
      makeDirectory: async () => undefined,
      sidecarPath: "/tmp/sidecar.js",
      checkHealth: async () => true,
      delay: (ms) => Bun.sleep(ms),
      startStallTimeout: 100,
      stopTimeout: 25,
    })
    const started = spawnLocalServer("127.0.0.1", 4096, "secret", {
      needsMigration: false,
      userDataPath: "/tmp/opencode-user-data",
    })

    await Bun.sleep(0)
    child.emitMessage({ type: "ready" })
    await started

    expect(cwd).toBe(join("/tmp/opencode-user-data", "default-workspace"))
  })
})
