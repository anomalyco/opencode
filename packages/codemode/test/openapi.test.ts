import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { CodeMode } from "../src/index.js"
import { OpenAPI, type Document } from "../src/adapters/openapi/index.js"
import { inputTypeScript, outputTypeScript, Tool } from "../src/tool.js"

const baseUrl = "http://localhost:4096"
const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"])

type Recorded = {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

const opencodeSpec = async (): Promise<Document> => {
  return Bun.file(new URL("./fixtures/opencode-v2-openapi.json", import.meta.url)).json() as Promise<Document>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const operations = (spec: Document) =>
  Object.entries(isRecord(spec.paths) ? spec.paths : {}).flatMap(([path, pathValue]) =>
    isRecord(pathValue)
      ? Object.entries(pathValue).flatMap(([method, operation]) =>
          methods.has(method) && isRecord(operation) ? [{ path, method, operation }] : [],
        )
      : [],
  )

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

const toolPathEntries = (spec: Document) => {
  const used = new Set<string>()
  const namespaces = new Set<string>()
  return operations(spec)
    .filter((item) => {
      if (item.operation["x-websocket"] === true) return false
      const responses = isRecord(item.operation.responses) ? item.operation.responses : {}
      return !Object.entries(responses).some(
        ([status, response]) =>
          (/^2\d\d$/.test(status) || status.toUpperCase() === "2XX") &&
          isRecord(response) &&
          isRecord(response.content) &&
          Object.keys(response.content).some(
            (mediaType) => mediaType.split(";")[0]?.trim().toLowerCase() === "text/event-stream",
          ),
      )
    })
    .map((item) => {
      const { path, method, operation } = item
      const raw = nonEmptyString(operation.operationId)
      const segments = (raw === undefined ? [`${method}_${path.replaceAll(/[{}]/g, "")}`] : raw.split("."))
        .map(
          (segment) =>
            segment
              .replaceAll(/[^A-Za-z0-9_$]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .replace(/^([0-9])/, "_$1") || "operation",
        )
        .map((segment) => (["__proto__", "constructor", "prototype"].includes(segment) ? `${segment}_2` : segment))
      const key = segments.join(".")
      const prefixUsed = segments.slice(0, -1).some((_, index) => used.has(segments.slice(0, index + 1).join(".")))
      const conflict = segments.slice(0, -1).findIndex((_, index) => used.has(segments.slice(0, index + 1).join(".")))
      const collapsed =
        conflict >= 0 && conflict + 1 < segments.length
          ? segments.flatMap((segment, index) => {
              if (index === conflict) {
                const next = segments[index + 1] ?? ""
                return [`${segment}${next.charAt(0).toUpperCase()}${next.slice(1)}`]
              }
              return index === conflict + 1 ? [] : [segment]
            })
          : undefined
      const collapsedKey = collapsed?.join(".")
      const name =
        collapsedKey !== undefined && !used.has(collapsedKey) && !namespaces.has(collapsedKey)
          ? collapsedKey
          : used.has(key) || namespaces.has(key) || prefixUsed
            ? `${segments.join("_")}_2`
            : key
      used.add(name)
      for (const index of name.split(".").slice(0, -1).keys())
        namespaces.add(
          name
            .split(".")
            .slice(0, index + 1)
            .join("."),
        )
      return { ...item, name }
    })
}

const toolAt = (tools: unknown, name: string) =>
  name.split(".").reduce<unknown>((current, segment) => (isRecord(current) ? current[segment] : undefined), tools)

const jsonContentSchema = (content: unknown) =>
  isRecord(content)
    ? Object.entries(content).find(([mediaType]) => {
        const normalized = mediaType.split(";")[0]?.trim().toLowerCase() ?? ""
        return normalized === "application/json" || normalized.endsWith("+json")
      })?.[1]
    : undefined

const recordingClient = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) => {
  const requests: Array<Recorded> = []
  const layer = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const body =
          request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined
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

describe("OpenAPI.fromSpec", () => {
  test("converts every opencode operation into the expected tool shape", async () => {
    const spec = await opencodeSpec()
    const result = OpenAPI.fromSpec({ spec, baseUrl })

    const entries = toolPathEntries(spec)
    expect(entries.every((entry) => toolAt(result.tools, entry.name) !== undefined)).toBe(true)
    expect(result.skipped).toContainEqual({
      method: "GET",
      path: "/api/pty/{ptyID}/connect",
      reason: "WebSocket operations are not supported",
    })
    expect(result.skipped.filter((item) => item.reason === "SSE operations are not supported")).toHaveLength(3)
    expect(toolAt(result.tools, "v2.health.get")).not.toBeUndefined()
    expect(toolAt(result.tools, "v2.session.get")).not.toBeUndefined()
    expect(toolAt(result.tools, "v2.session.create")).not.toBeUndefined()

    const sessionGet = toolAt(result.tools, "v2.session.get")
    expect(Tool.isDefinition(sessionGet)).toBe(true)
    if (!Tool.isDefinition(sessionGet)) throw new Error("v2.session.get was not generated")
    expect(inputTypeScript(sessionGet)).toBe("{ sessionID: string }")
    expect(outputTypeScript(sessionGet)).toContain("id: string")
    expect(outputTypeScript(sessionGet)).toContain("additions: number")

    const switchAgent = toolAt(result.tools, "v2.session.switchAgent")
    expect(Tool.isDefinition(switchAgent)).toBe(true)
    if (!Tool.isDefinition(switchAgent)) throw new Error("v2.session.switchAgent was not generated")
    expect(inputTypeScript(switchAgent)).toBe("{ sessionID: string; agent: string }")

    const contextEntryPut = toolAt(result.tools, "v2.session.contextEntry.put")
    expect(Tool.isDefinition(contextEntryPut)).toBe(true)
    if (!Tool.isDefinition(contextEntryPut)) throw new Error("v2.session.contextEntry.put was not generated")
    expect(inputTypeScript(contextEntryPut)).toBe("{ sessionID: string; key: string; value: unknown }")
    expect(toolAt(result.tools, "v2_session_context_entry_put_2")).toBeUndefined()
    expect(toolAt(result.tools, "v2.pty.connect")).toBeUndefined()
    expect(toolAt(result.tools, "v2.session.log")).toBeUndefined()
    expect(toolAt(result.tools, "v2.event.subscribe")).toBeUndefined()
    expect(toolAt(result.tools, "v2.event.changes")).toBeUndefined()
    expect(toolAt(result.tools, "v2.fs.read")).not.toBeUndefined()
    expect(toolAt(result.tools, "v2.pty.connectToken")).not.toBeUndefined()

    for (const item of entries) {
      const tool = toolAt(result.tools, item.name)
      expect(tool).toMatchObject({
        _tag: "CodeModeTool",
        description:
          nonEmptyString(item.operation.description) ??
          nonEmptyString(item.operation.summary) ??
          `${item.method.toUpperCase()} ${item.path}`,
      })

      const toolRecord = isRecord(tool) ? tool : {}
      const input = isRecord(toolRecord.input) ? toolRecord.input : {}
      expect(input.type).toBe("object")
      const properties = isRecord(input.properties) ? input.properties : {}
      const parameters = Array.isArray(item.operation.parameters) ? item.operation.parameters.filter(isRecord) : []
      for (const name of parameters
        .map((parameter) => parameter.name)
        .filter((name): name is string => typeof name === "string")) {
        expect(Object.hasOwn(properties, name)).toBe(true)
      }

      const requestBody = isRecord(item.operation.requestBody) ? item.operation.requestBody : undefined
      const media = requestBody === undefined ? undefined : jsonContentSchema(requestBody.content)
      const bodySchema = isRecord(media) && isRecord(media.schema) ? media.schema : undefined
      if (bodySchema !== undefined && isRecord(bodySchema.properties)) {
        for (const name of Object.keys(bodySchema.properties)) expect(Object.hasOwn(properties, name)).toBe(true)
      }

      const successes = Object.entries(isRecord(item.operation.responses) ? item.operation.responses : {})
        .filter(([status]) => /^2\d\d$/.test(status) || status.toUpperCase() === "2XX")
        .map(([, response]) => (isRecord(response) ? response : {}))
      if (successes.some((response) => jsonContentSchema(response.content) !== undefined)) {
        expect(toolRecord.output).not.toBeUndefined()
      }
    }
  })

  test("documents that the opencode fixture is unauthenticated", async () => {
    const spec = await opencodeSpec()
    const components = isRecord(spec.components) ? spec.components : {}
    const result = OpenAPI.fromSpec({ spec, baseUrl })

    expect(spec.security).toStrictEqual([])
    expect(isRecord(components.securitySchemes) ? Object.keys(components.securitySchemes) : []).toStrictEqual([])
    const health = toolAt(result.tools, "v2.health.get")
    const healthInput = isRecord(health) ? health.input : undefined
    expect(healthInput).toMatchObject({ type: "object", properties: {} })
    const input = isRecord(healthInput) ? healthInput : {}
    expect(Object.keys(isRecord(input.properties) ? input.properties : {})).toStrictEqual([])
  })

  test("exposes real opencode operations through CodeMode discovery", async () => {
    const { layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools },
    })
    const result = await Effect.runPromise(
      runtime
        .execute(
          `
        return await tools.$codemode.search({ query: "global health", namespace: "opencode", limit: 1 })
      `,
        )
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value).toMatchObject({
      items: [
        {
          path: "tools.opencode.v2.health.get",
          description: "Check whether the API server is ready to accept requests.",
        },
      ],
    })
    expect(JSON.stringify(result.value)).toContain("healthy: true")
  })

  test("invokes real opencode path parameters and JSON request bodies", async () => {
    const { requests, layer } = recordingClient((request) => {
      if (request.method === "GET") return json({ id: "ses_123" })
      return json({ id: "ses_456" })
    })
    const runtime = CodeMode.make({
      tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools },
    })

    const result = await Effect.runPromise(
      runtime
        .execute(
          `
          const existing = await tools.opencode.v2.session.get({ sessionID: "ses_123" })
          const created = await tools.opencode.v2.session.create({ id: "ses_456" })
          return { existing, created }
        `,
        )
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ method: "GET", body: undefined })
    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_123")
    expect(requests[1]).toMatchObject({
      method: "POST",
      url: "http://localhost:4096/api/session",
      body: { id: "ses_456" },
    })
  })

  test("fails missing required parameters before auth and network", async () => {
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({
      tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools },
    })

    const result = await Effect.runPromise(
      runtime.execute("return await tools.opencode.v2.session.get({})").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("Missing required path parameter 'sessionID'")
    expect(requests).toHaveLength(0)
  })

  test("prefixes cross-location collisions and reconstructs the HTTP request", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "collision", version: "1.0.0" },
      paths: {
        "/echo": {
          post: {
            operationId: "echo",
            requestBody: {
              required: true,
              content: { "application/json": { schema: { type: "string" } } },
            },
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
    } satisfies Document
    const { requests, layer } = recordingClient(() => new Response(null, { status: 204 }))
    const tools = OpenAPI.fromSpec({ spec, baseUrl }).tools
    const update = toolAt(tools, "things.update")
    const echo = toolAt(tools, "echo")

    expect(Tool.isDefinition(update)).toBe(true)
    if (!Tool.isDefinition(update)) throw new Error("things.update was not generated")
    expect(inputTypeScript(update)).toBe(
      "{ path_id: string; query_id: string; path_id_2?: string; header_id: string; body_id: string }",
    )
    expect(Tool.isDefinition(echo)).toBe(true)
    if (!Tool.isDefinition(echo)) throw new Error("echo was not generated")
    expect(inputTypeScript(echo)).toBe("{ body: string }")

    const runtime = CodeMode.make({ tools })
    const result = await Effect.runPromise(
      runtime
        .execute(
          `
            const updated = await tools.things.update({ path_id: "path", query_id: "query", path_id_2: "literal", header_id: "header", body_id: "body" })
            const echoed = await tools.echo({ body: "hello" })
            return { updated, echoed }
          `,
        )
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true })
    expect(requests).toHaveLength(2)
    expect(new URL(requests[0]!.url).pathname).toBe("/things/path")
    expect(new URL(requests[0]!.url).searchParams.get("id")).toBe("query")
    expect(new URL(requests[0]!.url).searchParams.get("path_id")).toBe("literal")
    expect(requests[0]!.headers.id).toBe("header")
    expect(requests[0]!.body).toStrictEqual({ id: "body" })
    expect(requests[1]!.body).toBe("hello")
  })

  test("keeps bodies nested when flattening would lose schema semantics", () => {
    const body = (schema: Record<string, unknown>, required = true) => ({
      required,
      content: { "application/json": { schema } },
    })
    const spec = {
      openapi: "3.1.0",
      info: { title: "bodies", version: "1.0.0" },
      paths: Object.fromEntries(
        [
          [
            "optional",
            body(
              {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
                additionalProperties: false,
              },
              false,
            ),
          ],
          ["dictionary", body({ type: "object", additionalProperties: { type: "string" } })],
          [
            "composed",
            body({
              type: "object",
              allOf: [{ type: "object", properties: { name: { type: "string" } }, required: ["name"] }],
              additionalProperties: false,
            }),
          ],
          [
            "nullable",
            body({
              type: ["object", "null"],
              properties: { name: { type: "string" } },
              additionalProperties: false,
            }),
          ],
        ].map(([name, requestBody]) => [
          `/body/${name}`,
          {
            post: {
              operationId: `body.${name}`,
              requestBody,
              responses: { "204": { description: "Accepted" } },
            },
          },
        ]),
      ),
    } satisfies Document
    const tools = OpenAPI.fromSpec({ spec, baseUrl }).tools

    for (const name of ["optional", "dictionary", "composed", "nullable"]) {
      const tool = toolAt(tools, `body.${name}`)
      expect(Tool.isDefinition(tool)).toBe(true)
      if (!Tool.isDefinition(tool)) throw new Error(`body.${name} was not generated`)
      const input = isRecord(tool.input) ? tool.input : {}
      expect(Object.keys(isRecord(input.properties) ? input.properties : {})).toStrictEqual(["body"])
    }
    const optional = toolAt(tools, "body.optional")
    if (!Tool.isDefinition(optional)) throw new Error("body.optional was not generated")
    expect(inputTypeScript(optional)).toBe("{ body?: { name: string } }")
  })
})
