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
  return Bun.file(new URL("./fixtures/opencode-openapi.json", import.meta.url)).json() as Promise<Document>
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

const toolNameEntries = (spec: Document) => {
  const used = new Set<string>()
  return operations(spec).map((item) => {
    const { path, method, operation } = item
    const raw = nonEmptyString(operation.operationId) ?? `${method}_${path.replaceAll(/[{}]/g, "")}`
    const base = raw.replaceAll(/[^A-Za-z0-9_$]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "_$1") || "operation"
    const name = used.has(base) ? `${base}_2` : base
    used.add(name)
    return { ...item, name }
  })
}

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

    const entries = toolNameEntries(spec)
    expect(Object.keys(result.tools).sort()).toStrictEqual(entries.map((entry) => entry.name).sort())
    expect(result.skipped).toStrictEqual([])
    expect(Object.keys(result.tools)).toContain("global_health")
    expect(Object.keys(result.tools)).toContain("file_read")
    expect(Object.keys(result.tools)).toContain("session_create")

    for (const item of entries) {
      const tool = result.tools[item.name]
      expect(tool).toMatchObject({
        _tag: "CodeModeTool",
        description:
          nonEmptyString(item.operation.description) ?? nonEmptyString(item.operation.summary) ?? `${item.method.toUpperCase()} ${item.path}`,
      })

      const input = isRecord(tool?.input) ? tool.input : {}
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
        expect(Object.keys(isRecord(groupSchema.properties) ? groupSchema.properties : {}).sort()).toStrictEqual(
          names.sort(),
        )
      }

      const requestBody = isRecord(item.operation.requestBody) ? item.operation.requestBody : undefined
      if (requestBody !== undefined && jsonContentSchema(requestBody.content) !== undefined) {
        expect(properties).toHaveProperty("body")
      }

      const successes = Object.entries(isRecord(item.operation.responses) ? item.operation.responses : {})
        .filter(([status]) => /^2\d\d$/.test(status) || status.toUpperCase() === "2XX")
        .map(([, response]) => (isRecord(response) ? response : {}))
      if (successes.some((response) => jsonContentSchema(response.content) !== undefined)) {
        expect(tool?.output).not.toBeUndefined()
      }
    }
  })

  test("documents that the opencode fixture is unauthenticated", async () => {
    const spec = await opencodeSpec()
    const components = isRecord(spec.components) ? spec.components : {}
    const result = OpenAPI.fromSpec({ spec, baseUrl })

    expect(spec.security).toStrictEqual([])
    expect(isRecord(components.securitySchemes) ? Object.keys(components.securitySchemes) : []).toStrictEqual([])
    expect(result.tools.global_health?.input).toMatchObject({ type: "object", properties: {} })
    const input = isRecord(result.tools.global_health?.input) ? result.tools.global_health.input : {}
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
          path: "tools.opencode.global_health",
          description: "Get health information about the OpenCode server.",
        },
      ],
    })
    expect(JSON.stringify(result.value)).toContain("healthy: true")
    expect(JSON.stringify(result.value)).toContain("version: string")
  })

  test("invokes real opencode paths, query parameters, and JSON request bodies", async () => {
    const { requests, layer } = recordingClient((request) => {
      if (request.method === "GET") return json({ type: "raw", content: "hello" })
      return json({ id: "ses_123", version: "v2", time: { created: 0, updated: 0 }, title: "hello" })
    })
    const runtime = CodeMode.make({ tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools } })

    const result = await Effect.runPromise(
      runtime
        .execute(`
          const file = await tools.opencode.file_read({ query: { path: "README.md", directory: "/repo" } })
          const session = await tools.opencode.session_create({ body: { title: "hello" } })
          return { file, session }
        `)
        .pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: true })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ method: "GET", body: undefined })
    expect(new URL(requests[0]!.url).pathname).toBe("/file/content")
    expect(new URL(requests[0]!.url).searchParams.get("path")).toBe("README.md")
    expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe("/repo")
    expect(requests[1]).toMatchObject({
      method: "POST",
      url: "http://localhost:4096/session",
      body: { title: "hello" },
    })
  })

  test("fails missing required parameters before auth and network", async () => {
    const { requests, layer } = recordingClient(() => json({}))
    const runtime = CodeMode.make({ tools: { opencode: OpenAPI.fromSpec({ spec: await opencodeSpec(), baseUrl }).tools } })

    const result = await Effect.runPromise(
      runtime.execute("return await tools.opencode.file_read({})").pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("Missing required query parameter 'path'")
    expect(requests).toHaveLength(0)
  })
})
