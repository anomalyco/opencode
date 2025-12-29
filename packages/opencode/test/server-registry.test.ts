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

  test("register() with same ID overwrites existing entry", async () => {
    const server1: ServerRegistry.ServerEntry = {
      id: "duplicate-test",
      url: "http://localhost:7633",
      port: 7633,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }

    const server2: ServerRegistry.ServerEntry = {
      id: "duplicate-test",
      url: "http://localhost:7634",
      port: 7634,
      pid: process.pid + 1,
      lastHeartbeat: Date.now(),
    }

    await ServerRegistry.register(server1)
    await ServerRegistry.register(server2)

    const servers = await ServerRegistry.list()
    expect(servers).toHaveLength(1)
    expect(servers[0].port).toBe(7634)
    expect(servers[0].pid).toBe(process.pid + 1)
  })

  test("unregister() on nonexistent server is no-op", async () => {
    await ServerRegistry.unregister("nonexistent-id")
    const servers = await ServerRegistry.list()
    expect(servers).toEqual([])
  })

  test("heartbeat() on nonexistent server is no-op", async () => {
    await ServerRegistry.heartbeat("nonexistent-id")
    const servers = await ServerRegistry.list()
    expect(servers).toEqual([])
  })

  test("corrupted JSON file recovers to empty state", async () => {
    // Write invalid JSON
    await fs.writeFile(testFilePath, "{invalid json here}")

    // Should recover gracefully
    const servers = await ServerRegistry.list()
    expect(servers).toEqual([])

    // Should be able to register after recovery
    const server: ServerRegistry.ServerEntry = {
      id: "recovery-test",
      url: "http://localhost:7635",
      port: 7635,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }

    await ServerRegistry.register(server)
    const afterRegister = await ServerRegistry.list()
    expect(afterRegister).toHaveLength(1)
    expect(afterRegister[0].id).toBe("recovery-test")
  })

  test("sequential register() preserves all entries", async () => {
    // Note: Concurrent writes are not atomic across operations
    // This tests sequential registration which is the expected usage
    const servers = Array.from({ length: 5 }, (_, i) => ({
      id: `sequential-${i}`,
      url: `http://localhost:${7636 + i}`,
      port: 7636 + i,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }))

    for (const server of servers) {
      await ServerRegistry.register(server)
    }

    const result = await ServerRegistry.list()
    expect(result).toHaveLength(5)

    const ids = result.map((s) => s.id).sort()
    expect(ids).toEqual(["sequential-0", "sequential-1", "sequential-2", "sequential-3", "sequential-4"])
  })

  test("pruneStale() preserves fresh servers", async () => {
    const fresh1: ServerRegistry.ServerEntry = {
      id: "fresh-1",
      url: "http://localhost:7641",
      port: 7641,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    }

    const fresh2: ServerRegistry.ServerEntry = {
      id: "fresh-2",
      url: "http://localhost:7642",
      port: 7642,
      pid: process.pid,
      lastHeartbeat: Date.now() - 10000, // 10s ago
    }

    await ServerRegistry.register(fresh1)
    await ServerRegistry.register(fresh2)

    await ServerRegistry.pruneStale()
    const servers = await ServerRegistry.list()

    expect(servers).toHaveLength(2)
    expect(servers.map((s) => s.id).sort()).toEqual(["fresh-1", "fresh-2"])
  })

  test("pruneStale() on empty registry is no-op", async () => {
    await ServerRegistry.pruneStale()
    const servers = await ServerRegistry.list()
    expect(servers).toEqual([])
  })
})
