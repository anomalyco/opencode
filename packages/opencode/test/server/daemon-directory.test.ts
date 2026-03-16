import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

describe("daemon mode directory enforcement", () => {
  test("daemon mode returns 400 without directory", async () => {
    const app = Server.createApp({ daemon: true })
    const res = await app.request("/session")
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("directory")
  })

  test("daemon mode accepts directory query param", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const res = await app.request(`/session?directory=${tmp.path}`)
    expect(res.status).not.toBe(400)
  })

  test("daemon mode accepts x-opencode-directory header", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const res = await app.request("/session", {
      headers: { "x-opencode-directory": tmp.path },
    })
    expect(res.status).not.toBe(400)
  })

  test("daemon mode exempts /log", async () => {
    const app = Server.createApp({ daemon: true })
    const res = await app.request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "test", level: "info", message: "hi" }),
    })
    expect(res.status).not.toBe(400)
  })

  test("daemon mode exempts /doc", async () => {
    const app = Server.createApp({ daemon: true })
    const res = await app.request("/doc")
    expect(res.status).not.toBe(400)
  })

  test("non-daemon mode does not require directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const original = process.cwd()
    process.chdir(tmp.path)
    try {
      const app = Server.createApp({})
      const res = await app.request("/session")
      expect(res.status).not.toBe(400)
    } finally {
      process.chdir(original)
    }
  })

  test("daemon mode decodes URL-encoded directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const res = await app.request(`/session?directory=${encodeURIComponent(tmp.path)}`)
    expect(res.status).not.toBe(400)
  })
})
