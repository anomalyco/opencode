import { expect } from "bun:test"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Mcp } from "@opencode/core/mcp/index"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { echoMcpHandler } from "../../core/test/fixture/mcp-echo"
import { waitUntil } from "../../core/test/lib/eventually"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

// `.invalid` never resolves, so only the embedder's fetch can answer these.
const consoleServer = "https://console.invalid"
const mcpServer = "https://mcp.invalid/mcp"

it.live("sends Console config and remote MCP requests through the embedder's fetch", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-fetch-option-")
    const requested: string[] = []
    const methods: string[] = []
    const mcp = echoMcpHandler()
    yield* Effect.addFinalizer(() => Effect.promise(() => mcp.close()))
    const fetch = async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      requested.push(`${url.origin}${url.pathname}`)
      if (url.pathname === "/api/v2/config") return Response.json({})
      if (`${url.origin}${url.pathname}` !== mcpServer) return new Response("Not found", { status: 404 })
      const body: unknown = request.method === "POST" ? await request.clone().json() : undefined
      if (typeof body === "object" && body !== null && "method" in body && typeof body.method === "string")
        methods.push(body.method)
      return mcp.fetch(request)
    }
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        fetch,
        config: {
          directory: tmp.path,
          project: false,
          content: JSON.stringify({ mcp: { servers: { gateway: { type: "remote", url: mcpServer, oauth: false } } } }),
        },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (method: "GET" | "POST", route: string, body?: unknown) =>
      Effect.promise(async (signal) => {
        const url = new URL(route, "http://opencode.local")
        url.searchParams.set("location[directory]", tmp.path)
        const response = await handler(
          new Request(url, {
            method,
            headers: {
              authorization: `Basic ${btoa("opencode:secret")}`,
              ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
          }),
        )
        return response.status
      })
    const inLocation = <A, E>(effect: Effect.Effect<A, E, Mcp.Service>) =>
      effect.pipe(
        Effect.provide(
          LocationServiceMap.Service.get(
            LocationServiceMap.canonical(Location.Ref.make({ directory: tmp.path as Location.Ref["directory"] })),
          ),
        ),
        Effect.provideContext(context),
      )

    expect(
      yield* request("POST", "/api/credential", {
        integrationID: "opencode",
        value: { type: "key", key: "secret", metadata: { server: consoleServer } },
      }),
    ).toBe(200)
    expect(yield* request("GET", "/api/provider")).toBe(200)
    yield* waitUntil(Effect.sync(() => requested.includes(`${consoleServer}/api/v2/config`)))

    yield* waitUntil(
      inLocation(Mcp.Service.use((service) => service.tools())).pipe(
        Effect.map((tools) => tools.some((tool) => tool.server === "gateway" && tool.name === "echo")),
      ),
    )
    const result = yield* inLocation(
      Mcp.Service.use((service) => service.callTool({ server: "gateway", name: "echo" })),
    )
    expect(result.content).toEqual([{ type: "text", text: "called echo" }])
    expect(methods).toEqual(expect.arrayContaining(["initialize", "tools/list", "tools/call"]))

    // A reconnect requested over the API starts the connection in the request's fiber rather than the MCP service's.
    methods.length = 0
    expect(yield* request("POST", "/api/experimental/mcp/gateway/connect")).toBe(204)
    expect(methods).toContain("initialize")
  }),
)
