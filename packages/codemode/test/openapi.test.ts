import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { CodeMode, toolError } from "../src/index.js"
import { OpenAPI } from "../src/adapters/openapi.js"

// The example spec exercises: global apiKey default, an operation-level OAuth2
// override with scopes, path/query parameters, a JSON request body, component
// $refs, and a 204 no-content response.
const spec = {
  openapi: "3.1.0",
  info: { title: "Widgets API", version: "1.0.0" },
  servers: [{ url: "https://api.widgets.dev" }],
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/widgets": {
      get: {
        operationId: "listWidgets",
        summary: "List widgets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/Widget" } },
                    nextCursor: { type: "string" },
                  },
                  required: ["items"],
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "createWidget",
        summary: "Create a widget",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string", description: "Widget name" } },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" } } },
          },
        },
      },
    },
    "/widgets/{id}": {
      delete: {
        operationId: "deleteWidget",
        summary: "Delete a widget",
        security: [{ OAuth2: ["widgets:write"] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "deleted" } },
      },
    },
    "/upload": {
      post: {
        operationId: "uploadFile",
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object" } } } },
        responses: { "200": { description: "ok" } },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      OAuth2: { type: "oauth2" },
    },
    schemas: {
      Widget: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
      },
    },
  },
}

type Recorded = {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

const recordingClient = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) => {
  const requests: Array<Recorded> = []
  const layer = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const body =
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : undefined
        const url = Option.map(HttpClientRequest.toUrl(request), (resolved) => resolved.toString())
        requests.push({
          method: request.method,
          url: Option.getOrElse(url, () => request.url),
          headers: { ...request.headers },
          body,
        })
        return HttpClientResponse.fromWeb(request, respond(request))
      }),
    ),
  )
  return { requests, layer }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

const auth = {
  resolve: ({ schemeName, scopes }: { schemeName: string; scopes: ReadonlyArray<string> }) => {
    if (schemeName === "ApiKeyAuth") return Effect.succeed({ type: "apiKey", value: "key-123" } as const)
    if (schemeName === "OAuth2") {
      return Effect.succeed({ type: "bearer", token: `oauth-${scopes.join("+")}` } as const)
    }
    return Effect.succeed(undefined)
  },
}

describe("OpenAPI.fromSpec", () => {
  test("generates one tool per operation and reports unrepresentable ones", () => {
    const result = OpenAPI.fromSpec({ spec, auth })
    expect(Object.keys(result.tools).sort()).toStrictEqual(["createWidget", "deleteWidget", "listWidgets"])
    expect(result.skipped).toMatchObject([
      { method: "POST", path: "/upload", reason: expect.stringContaining("multipart/form-data") },
    ])
  })

  test("model-visible signatures expand component refs and never mention auth", () => {
    const runtime = CodeMode.make({ tools: { widgets: OpenAPI.fromSpec({ spec, auth }).tools } })
    const instructions = runtime.instructions()
    expect(instructions).toContain(
      "tools.widgets.listWidgets(input: { query?: { limit?: number; cursor?: string } }): Promise<{ items: Array<{ id: string; name: string }>; nextCursor?: string }> // List widgets",
    )
    expect(instructions).toContain(
      "tools.widgets.deleteWidget(input: { path: { id: string } }): Promise<null> // Delete a widget",
    )
    expect(instructions).toContain(
      "tools.widgets.createWidget(input: { body: { name: string } }): Promise<{ id: string; name: string }> // Create a widget",
    )
    expect(instructions).not.toContain("X-API-Key")
    expect(instructions).not.toContain("Authorization")
  })

  test("applies the global apiKey default and serializes query parameters", async () => {
    const { requests, layer } = recordingClient(() => json({ items: [{ id: "w_1", name: "one" }] }))
    const runtime = CodeMode.make({ tools: { widgets: OpenAPI.fromSpec({ spec, auth }).tools } })

    const result = await Effect.runPromise(
      runtime.execute("return await tools.widgets.listWidgets({ query: { limit: 5 } })").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true, value: { items: [{ id: "w_1", name: "one" }] } })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe("GET")
    expect(requests[0]!.url).toBe("https://api.widgets.dev/widgets?limit=5")
    expect(requests[0]!.headers["x-api-key"]).toBe("key-123")
    expect(requests[0]!.headers["authorization"]).toBeUndefined()
  })

  test("operation-level security replaces the default and passes scopes", async () => {
    const { requests, layer } = recordingClient(() => new Response(null, { status: 204 }))
    const runtime = CodeMode.make({ tools: { widgets: OpenAPI.fromSpec({ spec, auth }).tools } })

    const result = await Effect.runPromise(
      runtime.execute('return await tools.widgets.deleteWidget({ path: { id: "w 1" } })').pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true, value: null })
    expect(requests[0]!.method).toBe("DELETE")
    expect(requests[0]!.url).toBe("https://api.widgets.dev/widgets/w%201")
    expect(requests[0]!.headers["authorization"]).toBe("Bearer oauth-widgets:write")
    expect(requests[0]!.headers["x-api-key"]).toBeUndefined()
  })

  test("sends JSON request bodies and static host headers", async () => {
    const { requests, layer } = recordingClient(() => json({ id: "w_2", name: "two" }, 201))
    const runtime = CodeMode.make({
      tools: { widgets: OpenAPI.fromSpec({ spec, auth, headers: { "x-client": "codemode" } }).tools },
    })

    const result = await Effect.runPromise(
      runtime
        .execute('return await tools.widgets.createWidget({ body: { name: "two" } })')
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true, value: { id: "w_2", name: "two" } })
    expect(requests[0]!.body).toStrictEqual({ name: "two" })
    expect(requests[0]!.headers["x-client"]).toBe("codemode")
  })

  test("a missing required body fails clearly without hitting the network", async () => {
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({ tools: { widgets: OpenAPI.fromSpec({ spec, auth }).tools } })

    const result = await Effect.runPromise(
      runtime.execute("return await tools.widgets.createWidget({})").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("Missing required request body")
    expect(requests).toHaveLength(0)
  })

  test("non-2xx responses become safe tool failures carrying status and body", async () => {
    const { layer } = recordingClient(() => json({ message: "widget not found" }, 404))
    const runtime = CodeMode.make({ tools: { widgets: OpenAPI.fromSpec({ spec, auth }).tools } })

    const result = await Effect.runPromise(
      runtime
        .execute(`
          try {
            return await tools.widgets.listWidgets({})
          } catch (error) {
            return { message: error.message }
          }
        `)
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      ok: true,
      value: { message: 'GET /widgets failed with HTTP 404: {"message":"widget not found"}' },
    })
  })

  test("an unavailable credential fails clearly without hitting the network", async () => {
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: { widgets: OpenAPI.fromSpec({ spec, auth: { resolve: () => Effect.succeed(undefined) } }).tools },
    })

    const result = await Effect.runPromise(
      runtime.execute("return await tools.widgets.listWidgets({})").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "ToolFailure", message: expect.stringContaining("ApiKeyAuth") },
    })
    expect(requests).toHaveLength(0)
  })

  test("a failing resolver aborts instead of falling through", async () => {
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: {
        widgets: OpenAPI.fromSpec({
          spec,
          auth: { resolve: () => Effect.fail(toolError("token refresh failed")) },
        }).tools,
      },
    })

    const result = await Effect.runPromise(
      runtime.execute("return await tools.widgets.listWidgets({})").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: false, error: { kind: "ToolFailure", message: "token refresh failed" } })
    expect(requests).toHaveLength(0)
  })

  test("security: [] and empty OR alternatives allow unauthenticated calls", async () => {
    const open = {
      openapi: "3.1.0",
      info: { title: "Open API", version: "1.0.0" },
      servers: [{ url: "https://open.example" }],
      security: [{ ApiKeyAuth: [] }, {}],
      paths: {
        "/status": {
          get: { operationId: "getStatus", responses: { "200": { description: "ok" } } },
          post: { operationId: "postStatus", security: [], responses: { "200": { description: "ok" } } },
        },
      },
      components: { securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" } } },
    }
    const { requests, layer } = recordingClient(() => json({ ok: true }))
    const runtime = CodeMode.make({
      tools: { open: OpenAPI.fromSpec({ spec: open, auth: { resolve: () => Effect.succeed(undefined) } }).tools },
    })

    const result = await Effect.runPromise(
      runtime
        .execute("return [await tools.open.getStatus({}), await tools.open.postStatus({})]")
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true, value: [{ ok: true }, { ok: true }] })
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.headers["x-api-key"] === undefined)).toBe(true)
  })

  test("apiKey carriers follow the scheme declaration (query and cookie)", async () => {
    const carriers = {
      openapi: "3.1.0",
      info: { title: "Carriers", version: "1.0.0" },
      servers: [{ url: "https://carriers.example" }],
      paths: {
        "/q": { get: { operationId: "q", security: [{ QueryKey: [] }], responses: { "200": { description: "ok" } } } },
        "/c": { get: { operationId: "c", security: [{ CookieKey: [] }], responses: { "200": { description: "ok" } } } },
      },
      components: {
        securitySchemes: {
          QueryKey: { type: "apiKey", in: "query", name: "api_key" },
          CookieKey: { type: "apiKey", in: "cookie", name: "session" },
        },
      },
    }
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: {
        api: OpenAPI.fromSpec({
          spec: carriers,
          auth: { resolve: () => Effect.succeed({ type: "apiKey", value: "secret" } as const) },
        }).tools,
      },
    })

    const result = await Effect.runPromise(
      runtime.execute("return [await tools.api.q({}), await tools.api.c({})]").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true })
    expect(requests[0]!.url).toBe("https://carriers.example/q?api_key=secret")
    expect(requests[1]!.headers["cookie"]).toBe("session=secret")
  })

  test("output schemas follow response declarations", () => {
    const responses = {
      openapi: "3.1.0",
      info: { title: "Responses", version: "1.0.0" },
      servers: [{ url: "https://responses.example" }],
      paths: {
        "/wild": {
          get: {
            operationId: "wild",
            responses: {
              "2XX": {
                description: "ok",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
              },
            },
          },
        },
        "/errors": { get: { operationId: "errorsOnly", responses: { "404": { description: "missing" } } } },
        "/text": {
          get: {
            operationId: "getText",
            responses: { "200": { description: "ok", content: { "text/plain": { schema: { type: "string" } } } } },
          },
        },
        "/thing": {
          delete: { operationId: "deleteThing", responses: { "204": { description: "deleted" } } },
          post: {
            operationId: "createThing",
            responses: {
              "200": { description: "no content variant" },
              "201": {
                description: "created",
                content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } },
              },
            },
          },
        },
      },
    }
    const runtime = CodeMode.make({ tools: { api: OpenAPI.fromSpec({ spec: responses }).tools } })
    const instructions = runtime.instructions()
    expect(instructions).toContain("tools.api.wild(input: {}): Promise<{ ok?: boolean }>")
    expect(instructions).toContain("tools.api.errorsOnly(input: {}): Promise<unknown>")
    expect(instructions).toContain("tools.api.getText(input: {}): Promise<unknown>")
    expect(instructions).toContain("tools.api.deleteThing(input: {}): Promise<null>")
    expect(instructions).toContain("tools.api.createThing(input: {}): Promise<{ id?: string }>")
  })

  test("operation names are sanitized, deduplicated, and derived when operationId is missing", () => {
    const messy = {
      openapi: "3.1.0",
      info: { title: "Messy", version: "1.0.0" },
      servers: [{ url: "https://messy.example" }],
      paths: {
        "/a": {
          get: { operationId: "get widgets!", responses: { "200": { description: "ok" } } },
          post: { operationId: "dup", responses: { "200": { description: "ok" } } },
        },
        "/b": {
          get: { operationId: "dup", responses: { "200": { description: "ok" } } },
          post: { responses: { "200": { description: "ok" } } },
        },
        "/c": {
          get: { operationId: "constructor", responses: { "200": { description: "ok" } } },
          post: { operationId: "prototype", responses: { "200": { description: "ok" } } },
        },
      },
    }
    const result = OpenAPI.fromSpec({ spec: messy })
    expect(Object.keys(result.tools).sort()).toStrictEqual([
      "constructor_2",
      "dup",
      "dup_2",
      "get_widgets",
      "post__b",
      "prototype_2",
    ])
  })

  test("the operations filter curates tools without reporting them as skipped", () => {
    const result = OpenAPI.fromSpec({ spec, auth, operations: (operation) => operation.method === "GET" })
    expect(Object.keys(result.tools)).toStrictEqual(["listWidgets"])
    expect(result.skipped.map((entry) => entry.path)).not.toContain("/widgets/{id}")
  })

  test("declared header parameters are sent, override host headers, and reserved names are ignored", async () => {
    const headed = {
      openapi: "3.1.0",
      info: { title: "Headed", version: "1.0.0" },
      servers: [{ url: "https://headed.example" }],
      paths: {
        "/h": {
          get: {
            operationId: "h",
            parameters: [
              { name: "X-Trace", in: "header", schema: { type: "string" } },
              { name: "Authorization", in: "header", required: true, schema: { type: "string" } },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: { api: OpenAPI.fromSpec({ spec: headed, headers: { "x-trace": "host", "x-static": "kept" } }).tools },
    })
    expect(runtime.instructions()).not.toContain("Authorization")

    const result = await Effect.runPromise(
      runtime.execute('return await tools.api.h({ headers: { "X-Trace": "model" } })').pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true })
    expect(requests[0]!.headers["x-trace"]).toBe("model")
    expect(requests[0]!.headers["x-static"]).toBe("kept")
    expect(requests[0]!.headers["authorization"]).toBeUndefined()
  })

  test("path-level parameters merge and operation-level ones win", () => {
    const layered = {
      openapi: "3.1.0",
      info: { title: "Layered", version: "1.0.0" },
      servers: [{ url: "https://layered.example" }],
      paths: {
        "/l": {
          parameters: [
            { name: "v", in: "query", required: true, schema: { type: "integer" } },
            { name: "shared", in: "query", schema: { type: "string" } },
          ],
          get: {
            operationId: "l",
            parameters: [{ name: "v", in: "query", schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }
    const runtime = CodeMode.make({ tools: { api: OpenAPI.fromSpec({ spec: layered }).tools } })
    expect(runtime.instructions()).toContain("tools.api.l(input: { query?: { v?: string; shared?: string } })")
  })

  test("missing required query and header parameters fail before auth and network", async () => {
    const required = {
      openapi: "3.1.0",
      info: { title: "Required", version: "1.0.0" },
      servers: [{ url: "https://required.example" }],
      security: [{ ApiKeyAuth: [] }],
      paths: {
        "/r": {
          get: {
            operationId: "r",
            parameters: [
              { name: "q", in: "query", required: true, schema: { type: "string" } },
              { name: "X-Trace", in: "header", required: true, schema: { type: "string" } },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: { securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" } } },
    }
    const calls: Array<string> = []
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: {
        api: OpenAPI.fromSpec({
          spec: required,
          auth: {
            resolve: () => {
              calls.push("auth")
              return Effect.succeed({ type: "apiKey", value: "secret" } as const)
            },
          },
        }).tools,
      },
    })

    const queryResult = await Effect.runPromise(
      runtime.execute("return await tools.api.r({})").pipe(Effect.provide(layer)),
    )
    const headerResult = await Effect.runPromise(
      runtime.execute('return await tools.api.r({ query: { q: "ok" } })').pipe(Effect.provide(layer)),
    )

    expect(queryResult).toMatchObject({ ok: false })
    expect(JSON.stringify(queryResult)).toContain("Missing required query parameter 'q'")
    expect(headerResult).toMatchObject({ ok: false })
    expect(JSON.stringify(headerResult)).toContain("Missing required header parameter 'X-Trace'")
    expect(calls).toHaveLength(0)
    expect(requests).toHaveLength(0)
  })

  test("path parameter values that would retarget the URL are rejected", async () => {
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({ tools: { widgets: OpenAPI.fromSpec({ spec, auth }).tools } })

    const result = await Effect.runPromise(
      runtime.execute('return await tools.widgets.deleteWidget({ path: { id: ".." } })').pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("Invalid path parameter 'id'")
    expect(requests).toHaveLength(0)
  })

  test("non-absolute server URLs are skipped unless baseUrl overrides them", () => {
    const templated = {
      openapi: "3.1.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "https://{region}.example" }],
      paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "ok" } } } } },
    }
    const skipped = OpenAPI.fromSpec({ spec: templated })
    expect(Object.keys(skipped.tools)).toStrictEqual([])
    expect(skipped.skipped[0]!.reason).toContain("not an absolute URL")

    const relative = OpenAPI.fromSpec({ spec: { ...templated, servers: [{ url: "/v2" }] } })
    expect(relative.skipped[0]!.reason).toContain("not an absolute URL")

    const overridden = OpenAPI.fromSpec({ spec: templated, baseUrl: "https://real.example" })
    expect(Object.keys(overridden.tools)).toStrictEqual(["ping"])
  })
})
