import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import { LSPClient } from "../../src/lsp/client"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import * as Timeout from "../../src/util/timeout"

// Minimal fake LSP server that speaks JSON-RPC over stdio
function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  afterEach(() => {
    mock.restore()
  })

  test("handles workspace/workspaceFolders request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "workspace/workspaceFolders",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("handles client/registerCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/registerCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("handles client/unregisterCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/unregisterCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  })

  test("uses default startup timeout and respects override", async () => {
    const seen: number[] = []
    spyOn(Timeout, "withTimeout").mockImplementation(async (input, ms) => {
      seen.push(ms)
      return input
    })

    const base = spawnFakeServer() as unknown as LSPServer.Handle
    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: base,
          root: process.cwd(),
        }),
    })
    expect(seen[0]).toBe(45_000)
    await client.shutdown()

    const next = spawnFakeServer() as unknown as LSPServer.Handle
    const custom = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: {
            ...next,
            timeout: { startup: 12_345 },
          },
          root: process.cwd(),
        }),
    })
    expect(seen[1]).toBe(12_345)
    await custom.shutdown()
  })

  test("uses default diagnostics timeout and respects override", async () => {
    const seen: number[] = []
    spyOn(Timeout, "withTimeout").mockImplementation(async (input, ms) => {
      seen.push(ms)
      if (ms === 45_000) return input
      throw new Error("timeout")
    })

    const base = spawnFakeServer() as unknown as LSPServer.Handle
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: base,
          root: process.cwd(),
        })
        await client.waitForDiagnostics({ path: __filename })
        expect(seen[1]).toBe(3_000)
        await client.shutdown()
      },
    })

    const next = spawnFakeServer() as unknown as LSPServer.Handle
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const custom = await LSPClient.create({
          serverID: "fake",
          server: {
            ...next,
            timeout: { diagnostics: 9_876 },
          },
          root: process.cwd(),
        })
        await custom.waitForDiagnostics({ path: __filename })
        expect(seen[3]).toBe(9_876)
        await custom.shutdown()
      },
    })
  })
})
