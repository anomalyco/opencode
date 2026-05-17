import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const dsn = process.env.DATABASE_URL?.trim()
const hasPg = Boolean(dsn?.startsWith("postgresql://") || dsn?.startsWith("postgres://"))

describe.skipIf(!hasPg)("project bootstrap without prior instance (PG)", () => {
  test("GET /project returns 200 and [] when tenant has zero projects (browser-style URL)", async () => {
    const tenant = `list_${crypto.randomUUID()}`
    const prevWos = process.env["OPENCODE_WORKOS_ENABLED"]
    const prevE2e = process.env["OPENCODE_E2E_USER_ID"]
    try {
      process.env["OPENCODE_WORKOS_ENABLED"] = "false"
      process.env["OPENCODE_E2E_USER_ID"] = tenant

      const app = Server.createApp({})
      const urls = ["http://127.0.0.1:4096/project", "http://127.0.0.1:4096/project/"]
      for (const href of urls) {
        const res = await app.request(href, { method: "GET" })
        expect(res.status).toBe(200)
        const body = (await res.json()) as unknown[]
        expect(Array.isArray(body)).toBe(true)
        expect(body.length).toBe(0)
      }
    } finally {
      if (prevWos === undefined) delete process.env["OPENCODE_WORKOS_ENABLED"]
      else process.env["OPENCODE_WORKOS_ENABLED"] = prevWos
      if (prevE2e === undefined) delete process.env["OPENCODE_E2E_USER_ID"]
      else process.env["OPENCODE_E2E_USER_ID"] = prevE2e
    }
  })

  test("POST /project/create succeeds when tenant has zero projects (no chicken-and-egg)", async () => {
    const tenant = `bootstrap_${crypto.randomUUID()}`
    const prevWos = process.env["OPENCODE_WORKOS_ENABLED"]
    const prevE2e = process.env["OPENCODE_E2E_USER_ID"]
    try {
      process.env["OPENCODE_WORKOS_ENABLED"] = "false"
      process.env["OPENCODE_E2E_USER_ID"] = tenant

      const app = Server.createApp({})
      const res = await app.request("http://127.0.0.1/project/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "First project" }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { project?: { id?: string; name?: string } }
      expect(body.project?.name).toBe("First project")
      expect(body.project?.id).toBeTruthy()
    } finally {
      if (prevWos === undefined) delete process.env["OPENCODE_WORKOS_ENABLED"]
      else process.env["OPENCODE_WORKOS_ENABLED"] = prevWos
      if (prevE2e === undefined) delete process.env["OPENCODE_E2E_USER_ID"]
      else process.env["OPENCODE_E2E_USER_ID"] = prevE2e
    }
  })
})
