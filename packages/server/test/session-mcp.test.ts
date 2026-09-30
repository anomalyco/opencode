import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("adds and removes session-scoped MCP servers", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, method: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
      })
    const config = { config: { type: "local", command: ["unused"], disabled: true } }

    const created = Schema.decodeUnknownSync(SessionResponse)((yield* request("/api/session", "POST", {})).body)
    const path = `/api/experimental/session/${created.data.id}/mcp/ctx`

    expect((yield* request(path, "PUT", config)).status).toBe(204)
    expect((yield* request(path, "DELETE")).status).toBe(204)
    expect(yield* request(path, "DELETE")).toMatchObject({
      status: 404,
      body: { _tag: "McpServerNotFoundError", server: "ctx" },
    })
    expect(yield* request("/api/experimental/session/ses_missing/mcp/ctx", "PUT", config)).toMatchObject({
      status: 404,
      body: { _tag: "SessionNotFoundError" },
    })
  }).pipe(Effect.scoped),
)
