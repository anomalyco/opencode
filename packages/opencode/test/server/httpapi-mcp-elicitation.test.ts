import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const context = Context.empty() as Context.Context<unknown>
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()).pipe(Effect.ignore))
  }),
)
const it = testEffect(testStateLayer)

type TestHandler = ReturnType<typeof HttpApiApp.webHandler>

const request = Effect.fnUntraced(function* (
  handler: TestHandler,
  route: string,
  directory: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", directory)
  return yield* Effect.promise(() =>
    Promise.resolve(
      handler.handler(
        new Request(`http://localhost${route}`, {
          ...init,
          headers,
        }),
        context,
      ),
    ),
  )
})

const json = <A>(response: Response) => Effect.promise(() => response.json() as Promise<A>)

describe("mcp elicitation HttpApi", () => {
  it.instance(
    "lists pending MCP elicitations",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()

        const listed = yield* request(handler, "/mcp/elicitation", tmp.directory)
        expect(listed.status).toBe(200)
        const pending = yield* json<Array<{ id: string; server: string; message: string }>>(listed)
        expect(pending).toEqual([])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns typed errors for missing MCP elicitation replies",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const missing = "mcpel_missing"

        for (const input of [
          {
            path: `/mcp/elicitation/${missing}/reply`,
            init: {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ content: { allowed: true } }),
            },
          },
          { path: `/mcp/elicitation/${missing}/decline`, init: { method: "POST" } },
          { path: `/mcp/elicitation/${missing}/cancel`, init: { method: "POST" } },
        ]) {
          const response = yield* request(handler, input.path, tmp.directory, input.init)
          expect(response.status).toBe(404)
          expect(yield* json(response)).toEqual({
            _tag: "McpElicitationNotFoundError",
            requestID: missing,
            message: `MCP elicitation request not found: ${missing}`,
          })
        }
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
