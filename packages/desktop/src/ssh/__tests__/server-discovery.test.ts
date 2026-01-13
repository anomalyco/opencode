import { afterEach, describe, expect, test } from "bun:test"
import { discoverServer } from "../server-discovery"

const cleanup: Array<() => void> = []

afterEach(() => {
  const tasks = cleanup.splice(0)
  for (const task of tasks) {
    task()
  }
})

describe("Server Discovery", () => {
  test("discovers server health and compatibility", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/global/health") {
          return Response.json({ healthy: true, version: "1.2.3" })
        }
        return new Response("Not Found", { status: 404 })
      },
    })

    cleanup.push(() => server.stop())

    const result = await discoverServer({
      baseUrl: `http://127.0.0.1:${server.port}`,
      minVersion: "1.0.0",
      maxVersion: "2.0.0",
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.info.healthy).toBe(true)
    expect(result.info.version).toEqual("1.2.3")
    expect(result.compatible).toBe(true)
  })

  test("reports incompatible versions", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/global/health") {
          return Response.json({ healthy: true, version: "0.9.0" })
        }
        return new Response("Not Found", { status: 404 })
      },
    })

    cleanup.push(() => server.stop())

    const result = await discoverServer({
      baseUrl: `http://127.0.0.1:${server.port}`,
      minVersion: "1.0.0",
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("below minimum")
  })
})
