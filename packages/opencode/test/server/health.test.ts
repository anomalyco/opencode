import { describe, expect, it } from "bun:test"
import { Server } from "../../src/server/server"

describe("Health endpoints", () => {
  it("should return fast health check", async () => {
    const app = Server.App()
    const req = new Request("http://localhost:7625/health")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe("ok")
    expect(typeof json.uptime).toBe("number")
    expect(json.uptime).toBeGreaterThanOrEqual(0)
  })

  it("should return detailed status", async () => {
    const app = Server.App()
    const req = new Request("http://localhost:7625/status")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.healthy).toBe(true)
    expect(typeof json.version).toBe("string")
    expect(typeof json.uptime).toBe("number")

    // Memory diagnostics
    expect(typeof json.memory.heapUsed).toBe("number")
    expect(typeof json.memory.heapTotal).toBe("number")
    expect(typeof json.memory.rss).toBe("number")
    expect(typeof json.memory.external).toBe("number")

    // Process info
    expect(typeof json.process.pid).toBe("number")
    expect(typeof json.process.platform).toBe("string")
    expect(typeof json.process.arch).toBe("string")
  })

  it("should return global health check", async () => {
    const app = Server.App()
    const req = new Request("http://localhost:7625/global/health")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.healthy).toBe(true)
    expect(typeof json.version).toBe("string")
  })
})
