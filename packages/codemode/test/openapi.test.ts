import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { CodeMode, toolError } from "../src/index.js"
import { OpenAPI } from "../src/openapi.js"

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
      OAuth2: {
        type: "oauth2",
        flows: {
          authorizationCode: {
            authorizationUrl: "https://auth.widgets.dev/authorize",
            tokenUrl: "https://auth.widgets.dev/token",
            scopes: { "widgets:write": "Modify widgets" },
          },
        },
      },
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

/** Test transport: records every request and returns a canned response. */
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
    expect(result.skipped).toStrictEqual([
      { method: "POST", path: "/upload", reason: "request body has no JSON content (declared: multipart/form-data)" },
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
      runtime.execute('return await tools.widgets.listWidgets({ query: { limit: 5 } })').pipe(Effect.provide(layer)),
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
      tools: {
        widgets: OpenAPI.fromSpec({
          spec,
          auth: { resolve: () => Effect.succeed(undefined) },
        }).tools,
      },
    })

    const result = await Effect.runPromise(
      runtime.execute('return await tools.widgets.listWidgets({})').pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "ToolFailure", message: "GET /widgets requires authentication; no credential available for: ApiKeyAuth." },
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
      runtime.execute('return await tools.widgets.listWidgets({})').pipe(Effect.provide(layer)),
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

  test("2XX wildcard responses and error-only responses advertise the right output", () => {
    const ranges = {
      openapi: "3.1.0",
      info: { title: "Ranges", version: "1.0.0" },
      servers: [{ url: "https://ranges.example" }],
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
        "/errors": {
          get: { operationId: "errorsOnly", responses: { "404": { description: "missing" } } },
        },
      },
    }
    const runtime = CodeMode.make({ tools: { api: OpenAPI.fromSpec({ spec: ranges }).tools } })
    const instructions = runtime.instructions()
    expect(instructions).toContain("tools.api.wild(input: {}): Promise<{ ok?: boolean }>")
    expect(instructions).toContain("tools.api.errorsOnly(input: {}): Promise<unknown>")
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

  test("declared non-JSON responses advertise unknown instead of null", () => {
    const plain = {
      openapi: "3.1.0",
      info: { title: "Plain", version: "1.0.0" },
      servers: [{ url: "https://plain.example" }],
      paths: {
        "/text": {
          get: {
            operationId: "getText",
            responses: { "200": { description: "ok", content: { "text/plain": { schema: { type: "string" } } } } },
          },
        },
      },
    }
    const runtime = CodeMode.make({ tools: { api: OpenAPI.fromSpec({ spec: plain }).tools } })
    expect(runtime.instructions()).toContain("tools.api.getText(input: {}): Promise<unknown>")
  })

  test("two credentials colliding on one query parameter fail clearly", async () => {
    const colliding = {
      openapi: "3.1.0",
      info: { title: "Collide", version: "1.0.0" },
      servers: [{ url: "https://collide.example" }],
      paths: {
        "/x": {
          get: {
            operationId: "x",
            security: [{ KeyA: [], KeyB: [] }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: {
        securitySchemes: {
          KeyA: { type: "apiKey", in: "query", name: "api_key" },
          KeyB: { type: "apiKey", in: "query", name: "api_key" },
        },
      },
    }
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: {
        api: OpenAPI.fromSpec({
          spec: colliding,
          auth: { resolve: () => Effect.succeed({ type: "apiKey", value: "secret" } as const) },
        }).tools,
      },
    })

    const result = await Effect.runPromise(runtime.execute("return await tools.api.x({})").pipe(Effect.provide(layer)))

    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("two credentials on the 'api_key' query parameter")
    expect(requests).toHaveLength(0)
  })

  test("a no-content success response resolves to null even when default declares an error shape", () => {
    const mixed = {
      openapi: "3.1.0",
      info: { title: "Mixed", version: "1.0.0" },
      servers: [{ url: "https://mixed.example" }],
      paths: {
        "/thing": {
          delete: {
            operationId: "deleteThing",
            responses: {
              "204": { description: "deleted" },
              default: {
                description: "error",
                content: {
                  "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } },
                },
              },
            },
          },
        },
      },
    }
    const runtime = CodeMode.make({ tools: { api: OpenAPI.fromSpec({ spec: mixed }).tools } })
    expect(runtime.instructions()).toContain("tools.api.deleteThing(input: {}): Promise<null>")
  })

  test("auth cookies shadow model cookie parameters and model values are encoded", async () => {
    const cookieSpec = {
      openapi: "3.1.0",
      info: { title: "Cookies", version: "1.0.0" },
      servers: [{ url: "https://cookies.example" }],
      paths: {
        "/c": {
          get: {
            operationId: "c",
            security: [{ CookieKey: [] }],
            parameters: [
              { name: "session", in: "cookie", schema: { type: "string" } },
              { name: "theme", in: "cookie", schema: { type: "string" } },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: { securitySchemes: { CookieKey: { type: "apiKey", in: "cookie", name: "session" } } },
    }
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: {
        api: OpenAPI.fromSpec({
          spec: cookieSpec,
          auth: { resolve: () => Effect.succeed({ type: "apiKey", value: "real" } as const) },
        }).tools,
      },
    })

    const result = await Effect.runPromise(
      runtime
        .execute(`return await tools.api.c({ cookies: { session: "forged", theme: "dark; session=forged" } })`)
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true })
    expect(requests[0]!.headers["cookie"]).toBe("session=real; theme=dark%3B%20session%3Dforged")
  })

  test("missing required non-path parameters fail locally before auth or network", async () => {
    const strict = {
      openapi: "3.1.0",
      info: { title: "Strict", version: "1.0.0" },
      servers: [{ url: "https://strict.example" }],
      security: [{ Key: [] }],
      paths: {
        "/s": {
          get: {
            operationId: "s",
            parameters: [{ name: "tenant", in: "query", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: { securitySchemes: { Key: { type: "apiKey", in: "header", name: "X-Key" } } },
    }
    const { requests, layer } = recordingClient(() => json({}))
    const resolved: Array<string> = []
    const runtime = CodeMode.make({
      tools: {
        api: OpenAPI.fromSpec({
          spec: strict,
          auth: {
            resolve: ({ schemeName }) => {
              resolved.push(schemeName)
              return Effect.succeed({ type: "apiKey", value: "k" } as const)
            },
          },
        }).tools,
      },
    })

    const result = await Effect.runPromise(runtime.execute("return await tools.api.s({})").pipe(Effect.provide(layer)))

    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("Missing required query parameter 'tenant'")
    expect(resolved).toHaveLength(0)
    expect(requests).toHaveLength(0)
  })

  test("a static host header satisfies a required header parameter", async () => {
    const tenanted = {
      openapi: "3.1.0",
      info: { title: "Tenanted", version: "1.0.0" },
      servers: [{ url: "https://tenanted.example" }],
      paths: {
        "/t": {
          get: {
            operationId: "t",
            parameters: [{ name: "X-Tenant", in: "header", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: { api: OpenAPI.fromSpec({ spec: tenanted, headers: { "x-tenant": "acme" } }).tools },
    })

    const result = await Effect.runPromise(runtime.execute("return await tools.api.t({})").pipe(Effect.provide(layer)))

    expect(result).toMatchObject({ ok: true })
    expect(requests[0]!.headers["x-tenant"]).toBe("acme")
  })

  test("a JSON success sibling wins over an earlier no-content success", () => {
    const siblings = {
      openapi: "3.1.0",
      info: { title: "Siblings", version: "1.0.0" },
      servers: [{ url: "https://siblings.example" }],
      paths: {
        "/thing": {
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
    const runtime = CodeMode.make({ tools: { api: OpenAPI.fromSpec({ spec: siblings }).tools } })
    expect(runtime.instructions()).toContain("tools.api.createThing(input: {}): Promise<{ id?: string }>")
  })

  test("relative server URLs are skipped with a clear reason", () => {
    const relative = {
      openapi: "3.1.0",
      info: { title: "Relative", version: "1.0.0" },
      servers: [{ url: "/v2" }],
      paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "ok" } } } } },
    }
    const result = OpenAPI.fromSpec({ spec: relative })
    expect(Object.keys(result.tools)).toStrictEqual([])
    expect(result.skipped[0]!.reason).toContain("relative server URL")

    const overridden = OpenAPI.fromSpec({ spec: relative, baseUrl: "https://real.example" })
    expect(Object.keys(overridden.tools)).toStrictEqual(["ping"])
  })

  test("spec server variables substitute defaults and explicit values", () => {
    const templated = {
      openapi: "3.1.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "https://{region}.example/{version}", variables: { version: { default: "v1" } } }],
      paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "ok" } } } } },
    }
    const unresolved = OpenAPI.fromSpec({ spec: templated })
    expect(Object.keys(unresolved.tools)).toStrictEqual([])
    expect(unresolved.skipped[0]!.reason).toContain("unresolved variables")

    const resolved = OpenAPI.fromSpec({ spec: templated, serverVariables: { region: "eu" } })
    expect(Object.keys(resolved.tools)).toStrictEqual(["ping"])
  })

  test("throws on structurally invalid specs", () => {
    expect(() => OpenAPI.fromSpec({ spec: "[1,2]" })).toThrow("OpenAPI spec must be a JSON object.")
  })
})
