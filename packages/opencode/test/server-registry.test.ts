import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { ServerRegistry } from "../src/server/registry"
import path from "path"
import fs from "fs/promises"
import { Global } from "../src/global"

const testFilePath = path.join(Global.Path.data, "servers.json")

describe("ServerRegistry", () => {
  beforeEach(async () => {
    // Clean up before each test
    await fs.unlink(testFilePath).catch(() => {})
  })

  afterEach(async () => {
    // Clean up after each test
    await fs.unlink(testFilePath).catch(() => {})
  })

  test("register() creates a server entry", async () => {
    const server: ServerRegistry.ServerEntry = {
      id: "test-server-1",
      url: "http://localhost:7625",
      port: 7625,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }

    await ServerRegistry.register(server)
    const servers = await ServerRegistry.list()

    expect(servers).toHaveLength(1)
    expect(servers[0].id).toBe("test-server-1")
    expect(servers[0].url).toBe("http://localhost:7625")
    expect(servers[0].port).toBe(7625)
  })

  test("register() stores server with provided lastHeartbeat", async () => {
    const timestamp = Date.now()
    const server: ServerRegistry.ServerEntry = {
      id: "test-server-2",
      url: "http://localhost:7626",
      port: 7626,
      pid: process.pid,
      lastHeartbeat: timestamp,
    }

    await ServerRegistry.register(server)
    const servers = await ServerRegistry.list()

    expect(servers[0].lastHeartbeat).toBe(timestamp)
  })

  test("unregister() removes a server", async () => {
    const server: ServerRegistry.ServerEntry = {
      id: "test-server-3",
      url: "http://localhost:7627",
      port: 7627,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }

    await ServerRegistry.register(server)
    expect(await ServerRegistry.list()).toHaveLength(1)

    await ServerRegistry.unregister("test-server-3")
    expect(await ServerRegistry.list()).toHaveLength(0)
  })

  test("heartbeat() updates lastHeartbeat timestamp", async () => {
    const server: ServerRegistry.ServerEntry = {
      id: "test-server-4",
      url: "http://localhost:7628",
      port: 7628,
      pid: process.pid,
      lastHeartbeat: Date.now() - 5000,
    }

    await ServerRegistry.register(server)
    const beforeHeartbeat = (await ServerRegistry.list())[0].lastHeartbeat

    await Bun.sleep(10) // Small delay
    await ServerRegistry.heartbeat("test-server-4")

    const afterHeartbeat = (await ServerRegistry.list())[0].lastHeartbeat
    expect(afterHeartbeat).toBeGreaterThan(beforeHeartbeat)
  })

  test("pruneStale() removes expired servers", async () => {
    const server1: ServerRegistry.ServerEntry = {
      id: "fresh-server",
      url: "http://localhost:7629",
      port: 7629,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }

    const server2: ServerRegistry.ServerEntry = {
      id: "stale-server",
      url: "http://localhost:7630",
      port: 7630,
      pid: process.pid,
      lastHeartbeat: Date.now() - 35000, // 35 seconds ago (past TTL of 30s)
    }

    await ServerRegistry.register(server1)
    await ServerRegistry.register(server2)
    expect(await ServerRegistry.list()).toHaveLength(2)

    await ServerRegistry.pruneStale()
    const servers = await ServerRegistry.list()

    expect(servers).toHaveLength(1)
    expect(servers[0].id).toBe("fresh-server")
  })

  test("list() returns empty array when no servers", async () => {
    const servers = await ServerRegistry.list()
    expect(servers).toEqual([])
  })

  test("register() with metadata", async () => {
    const server: ServerRegistry.ServerEntry = {
      id: "test-server-meta",
      url: "http://localhost:7631",
      port: 7631,
      pid: process.pid,
      lastHeartbeat: Date.now(),
      metadata: {
        version: "1.0.0",
        tags: ["production"],
      },
    }

    await ServerRegistry.register(server)
    const servers = await ServerRegistry.list()

    expect(servers[0].metadata).toEqual({
      version: "1.0.0",
      tags: ["production"],
    })
  })

  test("atomic write prevents corruption", async () => {
    // Register a server
    const server: ServerRegistry.ServerEntry = {
      id: "atomic-test",
      url: "http://localhost:7632",
      port: 7632,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }

    await ServerRegistry.register(server)

    // Verify the temp file is cleaned up
    const tempFile = testFilePath + ".tmp"
    const exists = await fs
      .access(tempFile)
      .then(() => true)
      .catch(() => false)

    expect(exists).toBe(false)
  })
})
