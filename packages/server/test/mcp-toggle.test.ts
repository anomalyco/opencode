import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("persists disabling and enabling a failed MCP server in its config file", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-mcp-toggle-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    const config = path.join(project, "opencode.json")
    yield* Effect.promise(() =>
      Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
    )
    yield* Effect.promise(() =>
      fs.writeFile(
        config,
        JSON.stringify({
          mcp: { servers: { broken: { type: "local", command: [path.join(project, "missing-mcp-server")] } } },
        }),
      ),
    )
    const server = yield* startServer(global)
    const request = (route: string, method = "GET") => {
      const url = new URL(route, server.base)
      url.searchParams.set("location[directory]", project)
      return Effect.promise(() => fetch(url, { method, headers: server.headers }))
    }
    const status = Effect.fn(function* (expected: string) {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const response = yield* request("/api/mcp")
        const body: { data: { name: string; status: { status: string } }[] } = yield* Effect.promise(() =>
          response.json(),
        )
        const current = body.data.find((item) => item.name === "broken")?.status.status
        if (current === expected) return current
        yield* Effect.promise(() => Bun.sleep(50))
      }
      throw new Error(`MCP server did not reach ${expected}`)
    })
    const read = () => Effect.promise(() => fs.readFile(config, "utf8").then((text) => JSON.parse(text)))

    yield* status("failed")
    expect((yield* request("/api/experimental/mcp/broken/disconnect", "POST")).status).toBe(204)
    expect((yield* read()).mcp.servers.broken.disabled).toBe(true)
    yield* status("disabled")

    expect((yield* request("/api/experimental/mcp/broken/connect", "POST")).status).toBe(204)
    expect((yield* read()).mcp.servers.broken).not.toHaveProperty("disabled")
    yield* status("failed")
  }),
)
