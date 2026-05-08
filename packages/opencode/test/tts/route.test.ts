import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

describe("server tts route", () => {
  test("returns 400 for missing text", async () => {
    const app = Server.Legacy().app
    const res = await app.request("/tts/edge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test("returns 400 for empty text", async () => {
    const app = Server.Legacy().app
    const res = await app.request("/tts/edge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "" }),
    })
    expect(res.status).toBe(400)
  })

  test("returns 400 for whitespace text", async () => {
    const app = Server.Legacy().app
    const res = await app.request("/tts/edge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    })
    expect(res.status).toBe(400)
  })

  test(
    "returns audio/mpeg for valid text",
    async () => {
      const app = Server.Legacy().app
      const res = await app.request("/tts/edge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test speech" }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("audio/mpeg")
      expect(res.headers.get("cache-control")).toBe("no-store")
      const buf = await res.arrayBuffer()
      expect(buf.byteLength).toBeGreaterThan(100)
    },
    { timeout: 30_000 },
  )
})
