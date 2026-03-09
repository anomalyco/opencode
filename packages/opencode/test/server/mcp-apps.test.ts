import { describe, expect, test } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Flag } from "../../src/flag/flag"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function authHeaders(): Record<string, string> {
  if (!Flag.OPENCODE_SERVER_PASSWORD) return {}
  const creds = btoa(`opencode:${Flag.OPENCODE_SERVER_PASSWORD}`)
  return { Authorization: `Basic ${creds}` }
}

async function req(app: ReturnType<typeof Server.App>, path: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  })
}

describe("GET /mcp-app", () => {
  test("returns 200 with empty object when no MCP apps connected", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await req(app, "/mcp-app")
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(typeof body).toBe("object")
      },
    })
  })
})

describe("GET /mcp-app/resource", () => {
  test("returns 400 when no matching resource found", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await req(app, "/mcp-app/resource?uri=ui%3A%2F%2Ftest%2Fapp.html&server=nonexistent")
        expect(res.status).toBe(400)
      },
    })
  })

  test("returns 400 when query params are missing", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await req(app, "/mcp-app/resource")
        expect(res.status).toBe(400)
      },
    })
  })
})

describe("POST /mcp-app/tool-call", () => {
  test("returns 400 when server is not found", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await req(app, "/mcp-app/tool-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ server: "nonexistent", name: "tool" }),
        })
        expect(res.status).toBe(400)
      },
    })
  })

  test("returns 400 when body is invalid", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await req(app, "/mcp-app/tool-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invalid: "body" }),
        })
        expect(res.status).toBe(400)
      },
    })
  })
})
