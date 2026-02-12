import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as BusModule from "@/bus"
import { Config } from "../config/config"
import { LSPClient } from "./client"
import { LSPServer } from "./server"
import { Instance } from "../project/instance"
import { tmpdir } from "../../test/fixture/fixture"

type ClientLike = Awaited<ReturnType<typeof LSPClient.create>>
type ServerLike = {
  id: string
  extensions: string[]
  root: (file: string) => Promise<string | undefined>
  spawn: (root: string) => Promise<{ process: { kill: () => void } } | undefined>
}

const filePath = "/project/file.ts"
const rootPath = "/project"

let publishCalls: Array<[unknown, unknown]>
let createCalls: Array<{ serverID: string; server: unknown; root: string }>
let spawnCalls: string[]
let openCalls: string[]
let killCalls: string[]

let configSpy: ReturnType<typeof spyOn>
let createSpy: ReturnType<typeof spyOn>
let publishSpy: ReturnType<typeof spyOn>

let originalServers: [string, unknown][]

function makeClient(root: string): ClientLike {
  return {
    root,
    serverID: "mock",
    notify: {
      async open(input: { path: string }) {
        openCalls.push(input.path)
      },
    },
    diagnostics: new Map(),
    async waitForDiagnostics() {},
    async shutdown() {},
    connection: {} as any,
  } as ClientLike
}

function defer<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function setMockServers(server: ServerLike) {
  const entries = Object.entries(LSPServer)
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue
    if (!("id" in (value as any) && "root" in (value as any) && "spawn" in (value as any))) continue
    delete (LSPServer as any)[key]
  }
  ;(LSPServer as any).Mock = server
}

function restoreServers() {
  for (const key of Object.keys(LSPServer)) {
    delete (LSPServer as any)[key]
  }
  for (const [key, value] of originalServers) {
    ;(LSPServer as any)[key] = value
  }
}

async function loadLSP() {
  const mod = (await import(`./index?test=${Math.random().toString(36).slice(2)}`)) as {
    LSP: {
      Event: { Updated: unknown }
      touchFile: (file: string) => Promise<void>
    }
  }
  return mod.LSP
}

beforeEach(() => {
  publishCalls = []
  createCalls = []
  spawnCalls = []
  openCalls = []
  killCalls = []

  originalServers = Object.entries(LSPServer)

  const server: ServerLike = {
    id: "mock",
    extensions: [".ts"],
    root: async () => rootPath,
    spawn: async (root: string) => {
      spawnCalls.push(root)
      return {
        process: {
          kill() {
            killCalls.push(root)
          },
        },
      }
    },
  }
  setMockServers(server)

  configSpy = spyOn(Config, "get").mockImplementation(async () => ({ lsp: {} } as any))
  createSpy = spyOn(LSPClient, "create").mockImplementation(async (input: any) => {
    createCalls.push(input)
    return makeClient(input.root)
  })
  publishSpy = spyOn(BusModule.Bus, "publish").mockImplementation((event: unknown, payload: unknown) => {
    publishCalls.push([event, payload])
    return undefined as any
  })
})

afterEach(async () => {
  publishSpy.mockRestore()
  createSpy.mockRestore()
  configSpy.mockRestore()
  restoreServers()
  await Instance.disposeAll()
})

describe("LSP non-blocking initialization", () => {
  test("getClients returns immediately during initialization", async () => {
    configSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ lsp: {} } as any), 250)
        }),
    )

    const LSP = await loadLSP()
    const tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const started = Date.now()
        await LSP.touchFile(filePath)
        expect(Date.now() - started).toBeLessThan(100)
      },
    })

    expect(createCalls.length).toBe(0)
    expect(spawnCalls.length).toBe(0)
  })

  test("getClients returns [] when state is not cached", async () => {
    const LSP = await loadLSP()
    const tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.touchFile(filePath)
      },
    })

    expect(createCalls.length).toBe(0)
    expect(spawnCalls.length).toBe(0)
    expect(openCalls.length).toBe(0)
  })

  test("getClients returns ready clients after initialization completes", async () => {
    const LSP = await loadLSP()
    const tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.touchFile(filePath)
        await flush()
        await LSP.touchFile(filePath)
        await flush()
        await LSP.touchFile(filePath)
      },
    })

    expect(createCalls.length).toBe(1)
    expect(openCalls).toEqual([filePath])
  })

  test("Bus.publish(Event.Updated, {}) fires when client becomes ready", async () => {
    const pending = defer<ClientLike | undefined>()
    createSpy.mockImplementation(async (input: any) => {
      createCalls.push(input)
      return pending.promise
    })

    const LSP = await loadLSP()
    const tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.touchFile(filePath)
        await flush()
        await LSP.touchFile(filePath)
        await flush()
        expect(publishCalls.length).toBe(0)
        pending.resolve(makeClient(rootPath))
        await flush()
      },
    })

    expect(publishCalls.length).toBe(1)
    expect(publishCalls[0][0]).toBe(LSP.Event.Updated)
    expect(publishCalls[0][1]).toEqual({})
  })

  test("broken set prevents retries of failed servers", async () => {
    createSpy.mockImplementation(async (input: any) => {
      createCalls.push(input)
      throw new Error("create failed")
    })

    const LSP = await loadLSP()
    const tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.touchFile(filePath)
        await flush()
        await LSP.touchFile(filePath)
        await flush()
        await LSP.touchFile(filePath)
        await flush()
      },
    })

    expect(createCalls.length).toBe(1)
    expect(spawnCalls.length).toBe(1)
    expect(killCalls.length).toBe(2)
  })

  test("spawning map prevents duplicate spawn attempts", async () => {
    const pending = defer<ClientLike | undefined>()
    createSpy.mockImplementation(async (input: any) => {
      createCalls.push(input)
      return pending.promise
    })

    const LSP = await loadLSP()
    const tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.touchFile(filePath)
        await flush()
        await Promise.all([LSP.touchFile(filePath), LSP.touchFile(filePath)])
        await flush()
        pending.resolve(makeClient(rootPath))
        await flush()
      },
    })

    expect(createCalls.length).toBe(1)
    expect(spawnCalls.length).toBe(1)
  })
})
