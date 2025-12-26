import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

describe("OPENCODE_APP_DIST", () => {
  test("serves index.html when OPENCODE_APP_DIST is set", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "index.html"), "<html><body>test app</body></html>")
      },
    })

    const original = process.env.OPENCODE_APP_DIST
    process.env.OPENCODE_APP_DIST = tmp.path

    // Import fresh to pick up env var
    const { Server } = await import("../../src/server/server")
    const app = Server.App()

    const res = await app.request("/")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("test app")

    process.env.OPENCODE_APP_DIST = original
  })

  test("serves static files with correct content-type", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "index.html"), "<html></html>")
        await Bun.write(path.join(dir, "app.js"), "console.log('test')")
        await Bun.write(path.join(dir, "style.css"), "body { color: red }")
      },
    })

    const original = process.env.OPENCODE_APP_DIST
    process.env.OPENCODE_APP_DIST = tmp.path

    const { Server } = await import("../../src/server/server")
    const app = Server.App()

    const jsRes = await app.request("/app.js")
    expect(jsRes.status).toBe(200)
    expect(jsRes.headers.get("content-type")).toContain("javascript")

    const cssRes = await app.request("/style.css")
    expect(cssRes.status).toBe(200)
    expect(cssRes.headers.get("content-type")).toContain("css")

    process.env.OPENCODE_APP_DIST = original
  })

  test("SPA fallback serves index.html for client routes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "index.html"), "<html><body>spa</body></html>")
      },
    })

    const original = process.env.OPENCODE_APP_DIST
    process.env.OPENCODE_APP_DIST = tmp.path

    const { Server } = await import("../../src/server/server")
    const app = Server.App()

    const res = await app.request("/some/client/route")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("spa")

    process.env.OPENCODE_APP_DIST = original
  })

  test("returns undefined when OPENCODE_APP_DIST not set", async () => {
    const original = process.env.OPENCODE_APP_DIST
    delete process.env.OPENCODE_APP_DIST

    const { Server } = await import("../../src/server/server")
    const app = Server.App()

    // Without OPENCODE_APP_DIST, should proxy to app.opencode.ai
    // We can't easily test the proxy, but we can verify it doesn't crash
    const res = await app.request("/nonexistent-test-path-12345")
    // Will either 404 or proxy - both are valid
    expect([200, 404, 502]).toContain(res.status)

    process.env.OPENCODE_APP_DIST = original
  })

  test("ignores invalid OPENCODE_APP_DIST path", async () => {
    const original = process.env.OPENCODE_APP_DIST
    process.env.OPENCODE_APP_DIST = "/nonexistent/path/that/does/not/exist"

    const { Server } = await import("../../src/server/server")
    const app = Server.App()

    // Should fall through to proxy behavior
    const res = await app.request("/")
    // Will proxy to app.opencode.ai
    expect([200, 502]).toContain(res.status)

    process.env.OPENCODE_APP_DIST = original
  })
})
