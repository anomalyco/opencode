// The OpenAPI documents of the reference's `test/openapi.test.ts` and its fixtures, with calls to make against each.
// `conformance/catalog.ts` runs them through the reference and records the catalog, skipped operations, requests and
// results in `catalog.json`.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export type Credential =
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; value: string }
  | { type: "header"; name: string; value: string }

/** What the fake server answers. */
export type Reply = { status?: number; contentType?: string; contentLength?: string; body?: string | null }

export type Call = { tool: string; input: unknown; reply?: Reply }

export type Case = {
  name: string
  spec: Record<string, unknown>
  baseUrl?: string
  /** Credentials by security scheme name; a missing name resolves to nothing. */
  auth?: Record<string, Credential>
  headers?: Record<string, string>
  calls?: Array<Call>
  /** False when rendering signatures would take exponential time in the reference, as for a deep diamond. */
  render?: boolean
}

const baseUrl = "http://localhost:4096"
const json = (value: unknown, status = 200): Reply => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(value),
})
const ok = json({ ok: true })

const singleOperation = (operation: Record<string, unknown>, method = "get") => ({
  openapi: "3.1.0",
  paths: {
    "/test": { [method]: { operationId: "test", responses: { 200: { description: "Success" } }, ...operation } },
  },
})

const directionalSpec = (openapi: string) => ({
  openapi,
  paths: {
    "/users": {
      post: {
        operationId: "users.create",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
        },
        responses: {
          200: {
            description: "Created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ReadOnlyID: { type: "string", readOnly: true },
      User: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "password", "profile", "generated"],
        properties: {
          id: { type: "string", readOnly: true },
          name: { type: "string" },
          password: { type: "string", writeOnly: true },
          profile: {
            type: "object",
            additionalProperties: false,
            required: ["createdAt", "secret", "label"],
            properties: {
              createdAt: { type: "string", readOnly: true },
              secret: { type: "string", writeOnly: true },
              label: { type: "string" },
            },
          },
          generated: { $ref: "#/components/schemas/ReadOnlyID" },
        },
      },
    },
  },
})

const body = (properties: Record<string, unknown>) => ({
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: [...Object.keys(properties), "name"],
        properties: { ...properties, name: { type: "string" } },
      },
    },
  },
})
const loop = {
  Wrap: { allOf: [{ $ref: "#/components/schemas/Loop" }] },
  Loop: { allOf: [{ $ref: "#/components/schemas/Wrap" }, { readOnly: true }] },
}
const depth = 30
const diamond = Object.fromEntries(
  Array.from({ length: depth }, (_, index) => [
    `C${index}`,
    index === depth - 1
      ? { type: "object", properties: { id: { type: "string", readOnly: true }, name: { type: "string" } } }
      : { allOf: [{ $ref: `#/components/schemas/C${index + 1}` }, { $ref: `#/components/schemas/C${index + 1}` }] },
  ]),
)
const bodyOf = (schema: Record<string, unknown>, required = true) => ({
  required,
  content: { "application/json": { schema } },
})
const response = { responses: { 200: { description: "Success" } } }

export const cases = (reference: string): Array<Case> => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(reference, "test/fixtures", name), "utf8")) as Record<string, unknown>
  return [
    {
      name: "happy path",
      spec: fixture("openapi-happy-path.json"),
      baseUrl,
      auth: { BearerAuth: { type: "bearer", token: "bearer-secret" }, ApiKey: { type: "apiKey", value: "api-secret" } },
      calls: [
        {
          tool: "users.get",
          input: { userId: "user-1", include: ["profile", "permissions"], verbose: true, "X-Trace-ID": "trace-1" },
          reply: json({ id: "user-1", name: "Ada", email: "ada@example.test", role: "member" }),
        },
        {
          tool: "users.create",
          input: { name: "Grace", email: "grace@example.test", role: "admin" },
          reply: {
            status: 201,
            contentType: "application/vnd.example+json",
            body: JSON.stringify({ id: "user-2", name: "Grace", email: "grace@example.test", role: "admin" }),
          },
        },
        {
          tool: "search.run",
          input: { filter: { query: "effect", page: 2 }, tags: ["typescript", "runtime"] },
          reply: { contentType: "text/plain", body: "2 matches" },
        },
        { tool: "users.remove", input: { userId: "user-1" }, reply: { status: 204, body: null } },
        { tool: "users.get", input: { userId: "" }, reply: ok },
        { tool: "users.get", input: { userId: ".." }, reply: ok },
        { tool: "users.get", input: { userId: "a/b c" }, reply: { status: 404, contentType: "application/json", body: '{"error":"missing"}' } },
        { tool: "users.get", input: { userId: "x" }, reply: { status: 500, body: "x".repeat(2000) } },
      ],
    },
    {
      name: "transports",
      spec: fixture("openapi-transports.json"),
      baseUrl,
      calls: [{ tool: "records.get", input: {} }, { tool: "records.get", input: { recordID: "r1" }, reply: json({ id: "r1", value: "v" }) }],
    },
    {
      name: "path sanitization and collisions",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/first": { get: { ...response, operationId: "group.item" } },
          "/second": { get: { ...response, operationId: "group.item" } },
          "/third": { get: { ...response, operationId: "group..other" } },
          "/fourth": { get: { ...response, operationId: "group.item.deeper" } },
          "/fifth": { get: { ...response, operationId: "9 lives!" } },
        },
      },
    },
    {
      name: "unsupported operations reserve no names",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/first": { get: { operationId: "group.item", ...response } },
          "/unsupported": { get: { operationId: "group.item", ...response, "x-websocket": true } },
          "/last": { get: { operationId: "group.item", ...response } },
        },
      },
    },
    {
      name: "synthesized operation ids",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/users": { get: response, post: response },
          "/users/{id}": { get: response, patch: response, delete: response },
          "/organizations/{organizationId}/users/{id}": { get: response },
        },
      },
    },
    {
      name: "operation parameters override path parameters",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/test": {
            parameters: [{ name: "limit", in: "query", schema: { type: "string" } }],
            get: {
              operationId: "test",
              parameters: [
                { name: "limit", in: "query", schema: { type: "boolean" } },
                { name: "limit", in: "query", required: true, schema: { type: "number" } },
              ],
              responses: { 200: { description: "Success" } },
            },
          },
        },
      },
    },
    {
      name: "OpenAPI 3.0 normalization",
      baseUrl,
      spec: {
        openapi: "3.0.3",
        paths: {
          "/search": {
            get: {
              operationId: "search",
              parameters: [
                { in: "query", name: "value", schema: { type: "string", nullable: true, minLength: 2 } },
                { in: "query", name: "count", schema: { type: "integer", minimum: 1, exclusiveMinimum: true, maximum: 9 } },
                { in: "query", name: "either", schema: { nullable: true, allOf: [{ $ref: "#/components/schemas/Mode" }] } },
                { in: "query", name: "sample", schema: { type: "string", example: "abc" } },
              ],
              responses: {
                200: {
                  description: "Success",
                  content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Mode: { type: "string", enum: ["a", "b"] },
            Result: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/Mode" } } } },
          },
        },
      },
    },
    {
      name: "schema-local definitions",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/test": {
            get: {
              operationId: "test",
              responses: {
                200: {
                  description: "Success",
                  content: {
                    "application/json": { schema: { $ref: "#/$defs/Local", $defs: { Local: { type: "string" } } } },
                  },
                },
              },
            },
          },
        },
        components: { schemas: { Global: { type: "number" } } },
      },
    },
    {
      name: "directional 3.0",
      baseUrl,
      spec: directionalSpec("3.0.3"),
    },
    {
      name: "directional 3.1",
      baseUrl,
      spec: directionalSpec("3.1.0"),
      calls: [
        {
          tool: "users.create",
          input: {
            id: "ignored-top-level",
            generated: "ignored-generated",
            name: "Ada",
            password: "request-secret",
            profile: { createdAt: "sent-nested", secret: "nested-secret", label: "primary" },
          },
          reply: json({
            id: "server-id",
            name: "Ada",
            password: "returned-by-server",
            profile: { createdAt: "today", secret: "returned-secret", label: "primary" },
            generated: "generated-id",
          }),
        },
      ],
    },
    {
      name: "local refs and allOf composition",
      baseUrl,
      spec: singleOperation(
        {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["local", "composed", "name"],
                  properties: {
                    local: { $ref: "#/$defs/ReadOnlyValue" },
                    composed: { allOf: [{ $ref: "#/$defs/ReadOnlyValue" }] },
                    name: { type: "string" },
                  },
                  $defs: { ReadOnlyValue: { type: "string", readOnly: true } },
                },
              },
            },
          },
        },
        "post",
      ),
    },
    {
      name: "ref siblings",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/test": {
            post: {
              operationId: "test",
              responses: { 200: { description: "Success" } },
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      additionalProperties: false,
                      required: ["record"],
                      properties: {
                        record: {
                          $ref: "#/components/schemas/Base",
                          properties: { extra: { type: "string", readOnly: true }, note: { type: "string" } },
                          required: ["extra", "note", "id"],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Base: {
              type: "object",
              required: ["id", "name"],
              properties: { id: { type: "string", readOnly: true }, name: { type: "string" } },
            },
          },
        },
      },
    },
    {
      name: "intermediate reference hops",
      baseUrl,
      spec: {
        ...singleOperation(
          {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["secret", "name"],
                    properties: { secret: { $ref: "#/components/schemas/Middle" }, name: { type: "string" } },
                  },
                },
              },
            },
          },
          "post",
        ),
        components: {
          schemas: { Middle: { $ref: "#/components/schemas/Plain", readOnly: true }, Plain: { type: "string" } },
        },
      },
    },
    {
      name: "cyclic components",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/test": {
            post: {
              operationId: "test",
              responses: { 200: { description: "Success" } },
              requestBody: {
                required: true,
                content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } },
              },
            },
          },
        },
        components: {
          schemas: {
            Node: {
              type: "object",
              required: ["id", "name", "child"],
              properties: {
                id: { type: "string", readOnly: true },
                name: { type: "string" },
                child: { $ref: "#/components/schemas/Node" },
              },
            },
          },
        },
      },
    },
    {
      name: "diamond references",
      render: false,
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/test": {
            post: {
              operationId: "test",
              responses: { 200: { description: "Success" } },
              requestBody: {
                required: true,
                content: { "application/json": { schema: { $ref: "#/components/schemas/C0" } } },
              },
            },
          },
        },
        components: { schemas: diamond },
      },
    },
    {
      name: "hiding through cycles, one order",
      baseUrl,
      spec: {
        ...singleOperation(
          { requestBody: body({ a: { $ref: "#/components/schemas/Loop" }, b: { $ref: "#/components/schemas/Wrap" } }) },
          "post",
        ),
        components: { schemas: loop },
      },
    },
    {
      name: "hiding through cycles, the other order",
      baseUrl,
      spec: {
        ...singleOperation(
          { requestBody: body({ a: { $ref: "#/components/schemas/Wrap" }, b: { $ref: "#/components/schemas/Loop" } }) },
          "post",
        ),
        components: { schemas: loop },
      },
    },
    {
      name: "not, if and contains stay unprojected",
      baseUrl,
      spec: singleOperation(
        {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["record"],
                  properties: {
                    record: {
                      type: "object",
                      not: { required: ["secret"], properties: { secret: { type: "string", readOnly: true } } },
                      if: { required: ["kind"], properties: { kind: { type: "string", readOnly: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        "post",
      ),
    },
    {
      name: "directions only in alternatives",
      baseUrl,
      spec: singleOperation(
        {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["choice", "pick"],
                  properties: {
                    choice: { anyOf: [{ type: "string", readOnly: true }, { type: "number" }] },
                    pick: { oneOf: [{ type: "string", readOnly: true }, { type: "number" }] },
                  },
                },
              },
            },
          },
        },
        "post",
      ),
    },
    {
      name: "shadowed local $defs",
      baseUrl,
      spec: singleOperation(
        {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["record"],
                  $defs: { Value: { type: "string" } },
                  properties: {
                    record: {
                      type: "object",
                      required: ["x"],
                      properties: { x: { $ref: "#/$defs/Value" } },
                      $defs: { Value: { type: "string", readOnly: true } },
                    },
                  },
                },
              },
            },
          },
        },
        "post",
      ),
    },
    {
      name: "directions inside parameters",
      baseUrl,
      spec: singleOperation({
        parameters: [
          {
            name: "filter",
            in: "query",
            required: true,
            schema: {
              type: "object",
              required: ["state", "id"],
              properties: { state: { type: "string" }, id: { type: "string", readOnly: true } },
            },
          },
        ],
      }),
    },
    {
      name: "required across allOf branches",
      baseUrl,
      spec: singleOperation(
        {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "name"],
                  allOf: [
                    {
                      type: "object",
                      required: ["id", "name"],
                      properties: { id: { type: "string", readOnly: true }, name: { type: "string" } },
                    },
                  ],
                },
              },
            },
          },
        },
        "post",
      ),
    },
    {
      name: "simple and form parameters",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: {
          "/items/{keys}": {
            get: {
              operationId: "items",
              parameters: [
                { name: "keys", in: "path", required: true, schema: { type: "array", items: { type: "string" } } },
                { name: "tags", in: "query", style: "form", explode: false, schema: { type: "array" } },
                { name: "filter", in: "query", style: "form", explode: true, schema: { type: "object" } },
                { name: "nullable", in: "query", required: true, schema: { type: ["string", "null"] } },
                { name: "constructor", in: "query", schema: { type: "string" } },
                { name: "meta", in: "header", style: "simple", explode: true, schema: { type: "object" } },
                { name: "pair", in: "header", schema: { type: "object" } },
              ],
              responses: { 200: { description: "Success" } },
            },
          },
        },
      },
      calls: [
        {
          tool: "items",
          input: {
            keys: ["a!", "b*"],
            tags: ["x", "y"],
            filter: { state: "open", page: 2 },
            nullable: null,
            constructor: "safe",
            meta: { a: "b", c: "d" },
            pair: { a: 1.5, b: true },
          },
          reply: ok,
        },
        { tool: "items", input: { keys: [{}], nullable: 1 }, reply: ok },
        { tool: "items", input: { keys: ["k"] }, reply: ok },
      ],
    },
    {
      name: "exploded and deep-object query parameters",
      baseUrl,
      spec: singleOperation({
        parameters: [
          { name: "tags", in: "query", style: "form", explode: true, schema: { type: "array" } },
          { name: "filter", in: "query", style: "form", explode: true, schema: { type: "object" } },
          { name: "location", in: "query", style: "deepObject", explode: true, schema: { type: "object" } },
        ],
      }),
      calls: [
        {
          tool: "test",
          input: {
            tags: ["first value", "second&value"],
            filter: { state: "open now", page: 2 },
            location: { directory: "/tmp/a b", workspace: "work&1" },
          },
          reply: ok,
        },
        { tool: "test", input: { tags: [{}] }, reply: ok },
        { tool: "test", input: { filter: { state: {} } }, reply: ok },
        { tool: "test", input: { location: { directory: [] } }, reply: ok },
        { tool: "test", input: { location: "flat" }, reply: ok },
      ],
    },
    {
      name: "unsupported encodings and malformed security",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        security: [{ bearer: [] }],
        paths: {
          "/cookie": {
            get: {
              operationId: "cookie",
              parameters: [{ name: "session", in: "cookie", schema: { type: "string" } }],
              ...response,
            },
          },
          "/reserved": {
            get: {
              operationId: "reserved",
              parameters: [{ name: "query", in: "query", allowReserved: true, schema: { type: "string" } }],
              ...response,
            },
          },
          "/invalid-style": {
            get: {
              operationId: "invalidStyle",
              parameters: [{ name: "query", in: "query", style: 42, schema: { type: "string" } }],
              ...response,
            },
          },
          "/security": { get: { operationId: "security", security: null, ...response } },
          "/matrix": {
            get: {
              operationId: "matrix",
              parameters: [{ name: "m", in: "path", style: "matrix", required: true, schema: { type: "string" } }],
              ...response,
            },
          },
          "/deep": {
            get: {
              operationId: "deep",
              parameters: [{ name: "d", in: "query", style: "deepObject", explode: false, schema: { type: "object" } }],
              ...response,
            },
          },
          "/content": {
            get: {
              operationId: "content",
              parameters: [{ name: "c", in: "query", content: { "application/json": {} } }],
              ...response,
            },
          },
          "/neither": { get: { operationId: "neither", parameters: [{ name: "n", in: "query" }], ...response } },
          "/unknown": {
            get: { operationId: "unknown", parameters: [{ name: "u", in: "body", schema: {} }], ...response },
          },
          "/unnamed": { get: { operationId: "unnamed", parameters: [{ in: "query", schema: {} }], ...response } },
          "/explode": {
            get: {
              operationId: "explode",
              parameters: [{ name: "e", in: "query", explode: "yes", schema: {} }],
              ...response,
            },
          },
        },
      },
    },
    {
      name: "prototype-named missing scheme",
      baseUrl,
      spec: singleOperation({ security: [JSON.parse('{"__proto__":[]}')] }),
    },
    {
      name: "bearer authentication",
      baseUrl,
      spec: {
        ...singleOperation({ operationId: undefined }),
        security: [{ bearer: [] }],
        components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
      },
      auth: { bearer: { type: "bearer", token: "secret" } },
      calls: [{ tool: "getTest", input: {}, reply: ok }],
    },
    {
      name: "prototype-named query key",
      baseUrl,
      spec: {
        ...singleOperation({}),
        security: [{ key: [] }],
        components: { securitySchemes: { key: { type: "apiKey", in: "query", name: "__proto__" } } },
      },
      auth: { key: { type: "apiKey", value: "secret" } },
      calls: [{ tool: "test", input: {}, reply: ok }],
    },
    {
      name: "duplicate credentials",
      baseUrl,
      spec: {
        ...singleOperation({}),
        security: [{ first: [], second: [] }],
        components: {
          securitySchemes: {
            first: { type: "apiKey", in: "header", name: "x-key" },
            second: { type: "apiKey", in: "header", name: "x-key" },
          },
        },
      },
      auth: { first: { type: "apiKey", value: "secret" }, second: { type: "apiKey", value: "secret" } },
      calls: [{ tool: "test", input: {}, reply: ok }],
    },
    {
      name: "cookie authentication",
      baseUrl,
      spec: {
        ...singleOperation({}),
        security: [{ key: [] }],
        components: { securitySchemes: { key: { type: "apiKey", in: "cookie", name: "session" } } },
      },
    },
    {
      name: "supported alternative",
      baseUrl,
      spec: {
        ...singleOperation({}),
        security: [{ cookie: [] }, { bearer: [] }],
        components: {
          securitySchemes: {
            cookie: { type: "apiKey", in: "cookie", name: "session" },
            bearer: { type: "http", scheme: "bearer" },
          },
        },
      },
      auth: { bearer: { type: "bearer", token: "secret" } },
      calls: [{ tool: "test", input: {}, reply: ok }],
    },
    {
      name: "carriers",
      baseUrl,
      headers: { "X-Static": "static", Authorization: "overridden" },
      spec: {
        ...singleOperation({ parameters: [{ name: "x-static", in: "header", schema: { type: "string" } }] }),
        security: [{ basic: [], custom: [] }, { none: [] }],
        components: {
          securitySchemes: {
            basic: { type: "http", scheme: "Basic" },
            custom: { type: "oauth2" },
            none: { type: "openIdConnect" },
          },
        },
      },
      auth: {
        basic: { type: "basic", username: "user", password: "pässword" },
        custom: { type: "header", name: "X-Custom", value: "c" },
      },
      calls: [
        { tool: "test", input: {}, reply: ok },
        { tool: "test", input: { "x-static": "declared" }, reply: ok },
      ],
    },
    {
      name: "missing credentials",
      baseUrl,
      spec: {
        ...singleOperation({}),
        security: [{ a: [] }, { b: [] }],
        components: { securitySchemes: { a: { type: "http", scheme: "bearer" }, b: { type: "oauth2" } } },
      },
      auth: { b: { type: "apiKey", value: "v" } },
      calls: [{ tool: "test", input: {}, reply: ok }],
    },
    {
      name: "server precedence",
      spec: {
        openapi: "3.1.0",
        servers: [{ url: "https://document.example" }],
        paths: {
          "/op": {
            get: { operationId: "op", servers: [{ url: "https://operation.example/v1/" }], ...response },
          },
          "/path": { servers: [{ url: "https://path.example" }], get: { operationId: "path", ...response } },
          "/doc": { get: { operationId: "doc", ...response } },
          "/templated": {
            get: { operationId: "templated", servers: [{ url: "https://{region}.example" }], ...response },
          },
          "/relative": { get: { operationId: "relative", servers: [{ url: "/v1" }], ...response } },
          "/none": { get: { operationId: "none", servers: [], ...response } },
        },
      },
      calls: [
        { tool: "op", input: {}, reply: ok },
        { tool: "path", input: {}, reply: ok },
        { tool: "doc", input: {}, reply: ok },
      ],
    },
    {
      name: "base URL with a query",
      spec: singleOperation({}),
      baseUrl: "https://example.com/api?tenant=one",
    },
    { name: "malformed base URL", spec: singleOperation({}), baseUrl: "https:/example.com" },
    {
      name: "chained response refs",
      baseUrl,
      spec: {
        ...singleOperation({ responses: { 200: { $ref: "#/components/responses/First" } } }),
        components: {
          responses: {
            First: { $ref: "#/components/responses/Stream" },
            Stream: { content: { "text/event-stream": { schema: { type: "string" } } } },
          },
        },
      },
    },
    {
      name: "binary response schema",
      baseUrl,
      spec: {
        ...singleOperation({
          responses: { 200: { content: { "text/plain": { schema: { $ref: "#/components/schemas/File" } } } } },
        }),
        components: { schemas: { File: { type: "string", format: "binary" } } },
      },
    },
    {
      name: "unresolved response",
      baseUrl,
      spec: singleOperation({ responses: { 200: { $ref: "#/components/responses/Missing" } } }),
    },
    {
      name: "composite parameters before auth",
      baseUrl,
      spec: {
        ...singleOperation({
          parameters: [{ name: "filter", in: "query", style: "form", explode: true, schema: { type: "object" } }],
        }),
        security: [{ bearer: [] }],
        components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
      },
      auth: { bearer: { type: "bearer", token: "secret" } },
      calls: [{ tool: "test", input: { filter: { value: [1] } }, reply: ok }],
    },
    {
      name: "JSON media types",
      baseUrl,
      spec: singleOperation(
        { requestBody: { required: true, content: { "application/merge-patch+json": { schema: { type: "object" } } } } },
        "post",
      ),
      calls: [
        { tool: "test", input: { body: { name: "updated", n: 1.5, big: 1e21 } }, reply: ok },
        { tool: "test", input: {}, reply: ok },
      ],
    },
    {
      name: "oversized and malformed responses",
      baseUrl,
      spec: singleOperation({}),
      calls: [
        { tool: "test", input: {}, reply: { contentLength: String(50 * 1024 * 1024 + 1), body: null } },
        { tool: "test", input: {}, reply: { contentType: "application/json", body: "{" } },
        { tool: "test", input: {}, reply: { contentType: "application/json; charset=utf-8", body: "" } },
        { tool: "test", input: {}, reply: { status: 503, contentType: "application/json", body: "null" } },
        { tool: "test", input: {}, reply: { status: 400, body: null } },
      ],
    },
    {
      name: "non-JSON responses and unions",
      baseUrl,
      spec: singleOperation({
        responses: {
          200: { description: "Text", content: { "text/plain": { schema: { type: "string" } } } },
          204: { description: "Empty" },
          "2XX": { description: "Any", content: { "application/json": { schema: { type: "number" } } } },
        },
      }),
      calls: [{ tool: "test", input: {}, reply: { contentType: "text/plain", body: "123" } }],
    },
    {
      name: "untyped JSON response",
      baseUrl,
      spec: singleOperation({ responses: { 200: { content: { "application/json": {} } } } }),
      calls: [{ tool: "test", input: {}, reply: json({ dropped: true }) }],
    },
    {
      name: "cross-location collisions",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        info: { title: "collision", version: "1.0.0" },
        paths: {
          "/echo": {
            post: {
              operationId: "echo",
              requestBody: { required: true, content: { "application/json": { schema: { type: "string" } } } },
              responses: { "204": { description: "Echoed" } },
            },
          },
          "/things/{id}": {
            post: {
              operationId: "things.update",
              parameters: [
                { name: "id", in: "path", required: true, schema: { type: "string" } },
                { name: "id", in: "query", required: true, schema: { type: "string" } },
                { name: "path_id", in: "query", schema: { type: "string" } },
                { name: "id", in: "header", required: true, schema: { type: "string" } },
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { id: { type: "string" } },
                      required: ["id"],
                      additionalProperties: false,
                    },
                  },
                },
              },
              responses: { "204": { description: "Updated" } },
            },
          },
        },
      },
      calls: [
        {
          tool: "things.update",
          input: { path_id: "path", query_id: "query", path_id_2: "literal", header_id: "header", body_id: "body" },
          reply: { status: 204, body: null },
        },
        { tool: "things.update", input: { path_id: "path", query_id: "query", header_id: "header" }, reply: ok },
        { tool: "echo", input: { body: "hello" }, reply: { status: 204, body: null } },
      ],
    },
    {
      name: "bodies kept nested",
      baseUrl,
      spec: {
        openapi: "3.1.0",
        paths: Object.fromEntries(
          [
            [
              "optional",
              bodyOf(
                { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
                false,
              ),
            ],
            ["dictionary", bodyOf({ type: "object", additionalProperties: { type: "string" } })],
            [
              "composed",
              bodyOf({
                type: "object",
                allOf: [{ type: "object", properties: { name: { type: "string" } }, required: ["name"] }],
                additionalProperties: false,
              }),
            ],
            [
              "nullable",
              bodyOf({ type: ["object", "null"], properties: { name: { type: "string" } }, additionalProperties: false }),
            ],
            ["text", { required: true, content: { "text/plain": { schema: { type: "string" } } } }],
            ["flat", bodyOf({ type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"], additionalProperties: false })],
          ].map(([name, requestBody]) => [
            `/body/${name}`,
            { post: { operationId: `body.${name}`, requestBody, responses: { "204": { description: "Accepted" } } } },
          ]),
        ),
      },
      calls: [
        { tool: "body.optional", input: {}, reply: { status: 204, body: null } },
        { tool: "body.flat", input: { a: "x" }, reply: { status: 204, body: null } },
        { tool: "body.flat", input: { b: 1 }, reply: { status: 204, body: null } },
      ],
    },
  ]
}
