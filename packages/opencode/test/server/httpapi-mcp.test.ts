import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { McpPaths } from "../../src/server/routes/instance/httpapi/mcp"
import { Instance } from "../../src/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", directory)
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("mcp HttpApi", () => {
  test("serves status endpoint", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const response = await request(McpPaths.status, tmp.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ demo: { status: "disabled" } })
  })

  test("serves add, connect, and disconnect endpoints", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const added = await request(McpPaths.status, tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "added",
        config: {
          type: "local",
          command: ["echo", "added"],
          enabled: false,
        },
      }),
    })
    expect(added.status).toBe(200)
    expect(await added.json()).toMatchObject({ added: { status: "disabled" } })

    const connected = await request("/mcp/demo/connect", tmp.path, { method: "POST" })
    expect(connected.status).toBe(200)
    expect(await connected.json()).toBe(true)

    const disconnected = await request("/mcp/demo/disconnect", tmp.path, { method: "POST" })
    expect(disconnected.status).toBe(200)
    expect(await disconnected.json()).toBe(true)
  })

  test("serves deterministic OAuth endpoints", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const start = await request("/mcp/demo/auth", tmp.path, { method: "POST" })
    expect(start.status).toBe(400)

    const authenticate = await request("/mcp/demo/auth/authenticate", tmp.path, { method: "POST" })
    expect(authenticate.status).toBe(400)

    const removed = await request("/mcp/demo/auth", tmp.path, { method: "DELETE" })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ success: true })
  })
})
