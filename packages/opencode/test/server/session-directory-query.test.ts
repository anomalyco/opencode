import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const dsn = process.env.DATABASE_URL?.trim()
const hasPg = Boolean(dsn?.startsWith("postgresql://") || dsn?.startsWith("postgres://"))

/**
 * Regression: GET /session?directory=<projectId> must scope Session.list to that project.
 * Global sync uses the root SDK client (no x-opencode-project); only ?directory= disambiguates.
 */
describe.skipIf(!hasPg)("GET /session?directory=", () => {
  test("returns only sessions for the directory project, not the tenant default", async () => {
    const tenant = "e2e_test_user"
    const prevE2E = process.env["OPENCODE_E2E_USER_ID"]
    const prevWos = process.env["OPENCODE_WORKOS_ENABLED"]
    try {
      process.env["OPENCODE_E2E_USER_ID"] = tenant
      process.env["OPENCODE_WORKOS_ENABLED"] = "false"

      const left = await Project.createSimple({ name: "http-dir-a", tenantUserId: tenant })
      const right = await Project.createSimple({ name: "http-dir-b", tenantUserId: tenant })

      await Instance.provide({
        project: left.project,
        fn: async () => Session.create({ title: "only-on-a" }),
      })

      const app = Server.createApp({})
      const url = `http://127.0.0.1/session?directory=${encodeURIComponent(right.project.id)}&roots=true&limit=50`
      const res = await app.request(url, { method: "GET" })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string; projectID: string; title?: string }[]
      expect(body.some((s) => s.title === "only-on-a")).toBe(false)
      expect(body.every((row) => row.projectID === right.project.id)).toBe(true)
    } finally {
      process.env["OPENCODE_WORKOS_ENABLED"] = prevWos
      if (prevE2E === undefined) delete process.env["OPENCODE_E2E_USER_ID"]
      else process.env["OPENCODE_E2E_USER_ID"] = prevE2E
    }
  })
})
