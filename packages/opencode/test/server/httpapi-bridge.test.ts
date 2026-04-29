import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { ControlPaths } from "../../src/server/routes/instance/httpapi/control"
import { FileApi, FilePaths } from "../../src/server/routes/instance/httpapi/file"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/global"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { OpenApi } from "effect/unstable/httpapi"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

const methods = ["get", "post", "put", "delete", "patch"] as const
let effectSpec: ReturnType<typeof OpenApi.fromApi> | undefined

function effectOpenApi() {
  return (effectSpec ??= OpenApi.fromApi(PublicApi))
}

function app(input?: { password?: string; username?: string }) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  Flag.OPENCODE_SERVER_PASSWORD = input?.password
  Flag.OPENCODE_SERVER_USERNAME = input?.username
  return Server.Default().app
}

function openApiRouteKeys(spec: { paths: Record<string, Partial<Record<(typeof methods)[number], unknown>>> }) {
  return Object.entries(spec.paths)
    .flatMap(([path, item]) =>
      methods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

function openApiParameters(spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }) {
  return Object.fromEntries(
    Object.entries(spec.paths).flatMap(([path, item]) =>
      methods
        .filter((method) => item[method])
        .map((method) => [
          `${method.toUpperCase()} ${path}`,
          (item[method]?.parameters ?? [])
            .map(parameterKey)
            .filter((param) => param !== undefined)
            .sort(),
        ]),
    ),
  )
}

function openApiRequestBodies(spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }) {
  return Object.fromEntries(
    Object.entries(spec.paths).flatMap(([path, item]) =>
      methods
        .filter((method) => item[method])
        .map((method) => [`${method.toUpperCase()} ${path}`, requestBodyKey(item[method]?.requestBody)]),
    ),
  )
}

type Operation = {
  parameters?: unknown[]
  responses?: unknown
  requestBody?: unknown
}

type RequestBody = {
  content?: Record<string, { schema?: { $ref?: string; type?: string } }>
  required?: boolean
}

function parameterKey(param: unknown) {
  if (!param || typeof param !== "object" || !("in" in param) || !("name" in param)) return
  if (typeof param.in !== "string" || typeof param.name !== "string") return
  return `${param.in}:${param.name}:${"required" in param && param.required === true}`
}

function parameterSchema(input: {
  spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }
  path: string
  method: (typeof methods)[number]
  name: string
}) {
  const param = input.spec.paths[input.path]?.[input.method]?.parameters?.find(
    (param) => !!param && typeof param === "object" && "name" in param && param.name === input.name,
  )
  if (!param || typeof param !== "object" || !("schema" in param)) return
  return param.schema
}

function requestBodyKey(body: unknown) {
  if (!body || typeof body !== "object" || !("content" in body)) return ""
  const requestBody = body as RequestBody
  return JSON.stringify({
    required: requestBody.required === true,
    content: Object.entries(requestBody.content ?? {})
      .map(([type, value]) => [type, value.schema?.$ref ?? value.schema?.type ?? "inline"])
      .sort(),
  })
}

function responseContentTypes(input: {
  spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }
  path: string
  method: (typeof methods)[number]
  status: string
}) {
  const responses = input.spec.paths[input.path]?.[input.method]?.responses
  if (!responses || typeof responses !== "object" || !(input.status in responses)) return []
  const response = (responses as Record<string, unknown>)[input.status]
  if (!response || typeof response !== "object" || !("content" in response)) return []
  const content = (response as { content?: unknown }).content
  if (!content || typeof content !== "object") {
    return []
  }
  return Object.keys(content).sort()
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function fileUrl(input?: { directory?: string; token?: string }) {
  const url = new URL(`http://localhost${FilePaths.content}`)
  url.searchParams.set("path", "hello.txt")
  if (input?.directory) url.searchParams.set("directory", input.directory)
  if (input?.token) url.searchParams.set("auth_token", input.token)
  return url
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi server", () => {
  test("covers every generated OpenAPI route with Effect HttpApi contracts", async () => {
    const honoRoutes = openApiRouteKeys(await Server.openapi())
    const effectRoutes = openApiRouteKeys(effectOpenApi())

    expect(honoRoutes.filter((route) => !effectRoutes.includes(route))).toEqual([])
    expect(effectRoutes.filter((route) => !honoRoutes.includes(route))).toEqual([])
  })

  test("matches generated OpenAPI route parameters", async () => {
    const hono = openApiParameters(await Server.openapi())
    const effect = openApiParameters(effectOpenApi())

    expect(
      Object.keys(hono)
        .filter((route) => JSON.stringify(hono[route]) !== JSON.stringify(effect[route]))
        .map((route) => ({ route, hono: hono[route], effect: effect[route] })),
    ).toEqual([])
  })

  test("matches generated OpenAPI request body shape", async () => {
    const hono = openApiRequestBodies(await Server.openapi())
    const effect = openApiRequestBodies(effectOpenApi())

    expect(
      Object.keys(hono)
        .filter((route) => hono[route] !== effect[route])
        .map((route) => ({ route, hono: hono[route], effect: effect[route] })),
    ).toEqual([])
  })

  test("matches SDK-affecting query parameter schemas", async () => {
    const effect = effectOpenApi()

    expect(parameterSchema({ spec: effect, path: "/session", method: "get", name: "roots" })).toEqual({
      anyOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }],
    })
    expect(parameterSchema({ spec: effect, path: "/session", method: "get", name: "start" })).toEqual({
      type: "number",
    })
    expect(parameterSchema({ spec: effect, path: "/find/file", method: "get", name: "limit" })).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 200,
    })
    expect(
      parameterSchema({ spec: effect, path: "/session/{sessionID}/message", method: "get", name: "limit" }),
    ).toEqual({
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    })
  })

  test("documents event routes as server-sent events", () => {
    const effect = effectOpenApi()

    expect(responseContentTypes({ spec: effect, path: "/event", method: "get", status: "200" })).toEqual([
      "text/event-stream",
    ])
    expect(responseContentTypes({ spec: effect, path: "/global/event", method: "get", status: "200" })).toEqual([
      "text/event-stream",
    ])
  })

  test("allows requests when auth is disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app().request(fileUrl(), {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "hello" })
  })

  test("provides instance context to bridged handlers", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await app().request("/project/current", {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ worktree: tmp.path })
  })

  test("requires credentials when auth is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const [missing, bad, good] = await Promise.all([
      app({ password: "secret" }).request(fileUrl(), {
        headers: { "x-opencode-directory": tmp.path },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "wrong"),
          "x-opencode-directory": tmp.path,
        },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "secret"),
          "x-opencode-directory": tmp.path,
        },
      }),
    ])

    expect(missing.status).toBe(401)
    expect(bad.status).toBe(401)
    expect(good.status).toBe(200)
  })

  test("accepts auth_token query credentials", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app({ password: "secret" }).request(
      fileUrl({ token: Buffer.from("opencode:secret").toString("base64") }),
      {
        headers: {
          "x-opencode-directory": tmp.path,
        },
      },
    )

    expect(response.status).toBe(200)
  })

  test("selects instance from query before directory header", async () => {
    await using header = await tmpdir({ git: true })
    await using query = await tmpdir({ git: true })
    await Bun.write(`${header.path}/hello.txt`, "header")
    await Bun.write(`${query.path}/hello.txt`, "query")

    const response = await app().request(fileUrl({ directory: query.path }), {
      headers: {
        "x-opencode-directory": header.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "query" })
  })

  test("serves global health from Effect HttpApi", async () => {
    const response = await app().request(`${GlobalPaths.health}?directory=/does/not/exist/opencode-test`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ healthy: true })
  })

  test("serves global event stream from Effect HttpApi", async () => {
    const response = await app().request(GlobalPaths.event)
    if (!response.body) throw new Error("missing event stream body")
    const reader = response.body.getReader()
    const chunk = await reader.read()
    await reader.cancel()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(new TextDecoder().decode(chunk.value)).toContain("server.connected")
  })

  test("serves control log from Effect HttpApi", async () => {
    const response = await app().request(ControlPaths.log, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "httpapi-test", level: "info", message: "hello" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  test("validates control auth without falling through to 404", async () => {
    const response = await app().request(ControlPaths.auth.replace(":providerID", "test"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api" }),
    })

    expect(response.status).toBe(400)
  })

  test("validates global upgrade without invoking installers", async () => {
    const response = await app().request(GlobalPaths.upgrade, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false })
  })
})
