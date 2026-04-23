import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

describe("GET /auth/session", () => {
  let prevWorkos: string | undefined

  beforeAll(() => {
    prevWorkos = process.env["OPENCODE_WORKOS_ENABLED"]
    delete process.env["OPENCODE_WORKOS_ENABLED"]
  })
  afterAll(() => {
    if (prevWorkos === undefined) delete process.env["OPENCODE_WORKOS_ENABLED"]
    else process.env["OPENCODE_WORKOS_ENABLED"] = prevWorkos
  })

  test("returns user: null when WorkOS is not enabled (no fake local user)", async () => {
    const app = Server.createApp({})
    const r = await app.request("http://x/auth/session", { method: "GET" })
    expect(r.status).toBe(200)
    const j = (await r.json()) as { user: unknown }
    expect(j.user).toBeNull()
  })
})
