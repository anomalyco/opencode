import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("routes MCP server names longer than 100 characters to their handler (#53401)", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-mcp-route-")
    const server = yield* startServer(tmp.path)
    const name = `t3-code-${"a".repeat(150)}`
    const url = new URL(`/api/experimental/mcp/${name}`, server.base)
    url.searchParams.set("location[directory]", tmp.path)

    const response = yield* Effect.promise(() => fetch(url, { method: "DELETE", headers: server.headers }))

    expect(response.status).toBe(404)
    expect(yield* Effect.promise(() => response.text())).toContain(name)
  }),
)
