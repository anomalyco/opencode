import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { CodeMode } from "../src/index.js"
import { OpenAPI, type Document } from "../src/adapters/openapi/index.js"

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
  return operations(spec).map((item) => {
    const { path, method, operation } = item
    const raw = nonEmptyString(operation.operationId)
    const segments = (raw === undefined ? [`${method}_${path.replaceAll(/[{}]/g, "")}`] : raw.split("."))
      .map((segment) => segment.replaceAll(/[^A-Za-z0-9_$]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "_$1") || "operation")
      .map((segment) => (["__proto__", "constructor", "prototype"].includes(segment) ? `${segment}_2` : segment))
    const key = segments.join(".")
    const prefixUsed = segments.slice(0, -1).some((_, index) => used.has(segments.slice(0, index + 1).join(".")))
    const name = used.has(key) || namespaces.has(key) || prefixUsed ? `${segments.join("_")}_2` : key
    used.add(name)
    for (const index of name.split(".").slice(0, -1).keys()) namespaces.add(name.split(".").slice(0, index + 1).join("."))
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
    expect(result.skipped).toStrictEqual([])
    expect(toolAt(result.tools, "v2.health.get")).not.toBeUndefined()
    expect(toolAt(result.tools, "v2.session.get")).not.toBeUndefined()
    expect(toolAt(result.tools, "v2.session.create")).not.toBeUndefined()

    for (const item of entries) {
      const tool = toolAt(result.tools, item.name)
      expect(tool).toMatchObject({
        _tag: "CodeModeTool",
        description:
          nonEmptyString(item.operation.description) ?? nonEmptyString(item.operation.summary) ?? `${item.method.toUpperCase()} ${item.path}`,
      })

      const toolRecord = isRecord(tool) ? tool : {}
      const input = isRecord(toolRecord.input) ? toolRecord.input : {}
      expect(input.type).toBe("object")
      const properties = isRecord(input.properties) ? input.properties : {}
      const parameters = Array.isArray(item.operation.parameters) ? item.operation.parameters.filter(isRecord) : []
      for (const group of [
        { name: "path", location: "path" },
        { name: "query", location: "query" },
        { name: "headers", location: "header" },
      ]) {
        const names = parameters
          .filter((parameter) => parameter.in === group.location)
          .map((parameter) => parameter.name)
          .filter((name): name is string => typeof name === "string")
        if (names.length === 0) continue
        const groupSchema = isRecord(properties[group.name]) ? properties[group.name] : {}
        const groupProperties = isRecord(groupSchema) && isRecord(groupSchema.properties) ? groupSchema.properties : {}
        expect(Object.keys(groupProperties).sort()).toStrictEqual(names.sort())
      }

      const requestBody = isRecord(item.operation.requestBody) ? item.operation.requestBody : undefined
      if (requestBody !== undefined && jsonContentSchema(requestBody.content) !== undefined) {
        expect(properties).toHaveProperty("body")
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
    const runtime = CodeMode.make({ tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools } })
    const result = await Effect.runPromise(
      runtime.execute(`
        return await tools.$codemode.search({ query: "global health", namespace: "opencode", limit: 1 })
      `).pipe(Effect.provide(layer)),
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
    const runtime = CodeMode.make({ tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools } })

    const result = await Effect.runPromise(
      runtime
        .execute(`
          const existing = await tools.opencode.v2.session.get({ path: { sessionID: "ses_123" } })
          const created = await tools.opencode.v2.session.create({ body: { id: "ses_456" } })
          return { existing, created }
        `)
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
    const runtime = CodeMode.make({ tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools } })

    const result = await Effect.runPromise(
      runtime.execute("return await tools.opencode.v2.session.get({})").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("Missing required path parameter 'sessionID'")
    expect(requests).toHaveLength(0)
  })
})
