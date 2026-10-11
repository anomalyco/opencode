import { expect } from "bun:test"
import { fileURLToPath } from "node:url"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live("lists configured MCP servers on the first request to a cold location", () =>
  Effect.gen(function* () {
    const request = yield* cold()
    const response = yield* request("GET", "/api/mcp")

    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      data: [{ name: "docs", status: { status: "disabled" } }],
    })
  }),
)

for (const operation of ["connect", "disconnect", "remove"] as const) {
  it.live(`${operation} finds configured MCP servers on a cold location`, () =>
    Effect.gen(function* () {
      const request = yield* cold()
      const response = yield* request(
        operation === "remove" ? "DELETE" : "POST",
        `/api/experimental/mcp/docs${operation === "remove" ? "" : `/${operation}`}`,
      )

      expect(response.status).toBe(204)
      const list = yield* request("GET", "/api/mcp")
      expect(yield* Effect.promise(() => list.json())).toMatchObject({
        data:
          operation === "remove"
            ? []
            : [{ name: "docs", status: { status: operation === "connect" ? "connected" : "disabled" } }],
      })
    }),
  )
}

const cold = Effect.fn(function* () {
  const tmp = yield* tmpdirScoped("opencode-mcp-list-")
  const context = yield* Layer.build(
    createRoutes({
      password: "secret",
      database: { path: ":memory:" },
      models: { fetch: false },
      fs: { filewatcher: false },
      config: {
        directory: tmp.path,
        project: false,
        content: JSON.stringify({
          mcp: {
            servers: {
              docs: {
                type: "local",
                command: [
                  process.execPath,
                  fileURLToPath(new URL("./fixture/mcp-starts.cjs", import.meta.url)),
                  `${tmp.path}/starts`,
                ],
                disabled: true,
              },
            },
          },
        }),
      },
    }).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  return (method: string, route: string) =>
    Effect.promise((signal) => {
      const url = new URL(route, "http://opencode.local")
      url.searchParams.set("location[directory]", tmp.path)
      return handler(
        new Request(url, { method, headers: { authorization: `Basic ${btoa("opencode:secret")}` }, signal }),
      )
    })
})
