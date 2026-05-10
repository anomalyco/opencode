import { afterEach, describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { SessionID } from "../../src/session/schema"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import {
  FilePaths,
  FileQuery,
  FindFileQuery,
  FindTextQuery,
} from "../../src/server/routes/instance/httpapi/groups/file"
import {
  ExperimentalPaths,
  SessionListQuery as ExperimentalSessionListQuery,
  ToolListQuery,
} from "../../src/server/routes/instance/httpapi/groups/experimental"
import { InstancePaths, VcsDiffQuery } from "../../src/server/routes/instance/httpapi/groups/instance"
import {
  ListQuery as SessionListQuery,
  MessagesQuery,
  SessionPaths,
} from "../../src/server/routes/instance/httpapi/groups/session"
import { MessagesQuery as V2MessagesQuery } from "../../src/server/routes/instance/httpapi/groups/v2/message"
import { SessionsQuery as V2SessionsQuery } from "../../src/server/routes/instance/httpapi/groups/v2/session"
import { QueryBoolean } from "../../src/server/routes/instance/httpapi/groups/query"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

type Method = "get" | "post" | "put" | "delete" | "patch"
type QuerySchema = { readonly fields: Record<string, unknown> }
type OpenApiSchema = { readonly maximum?: number; readonly minimum?: number; readonly type?: string }
type OpenApiParameter = { readonly name: string; readonly in: string; readonly schema?: OpenApiSchema }
type OpenApiOperation = { readonly parameters?: readonly OpenApiParameter[] }

const openApiDriftRoutes = [
  { method: "get", path: SessionPaths.list, query: SessionListQuery },
  { method: "get", path: SessionPaths.messages, query: MessagesQuery },
  { method: "get", path: FilePaths.findFile, query: FindFileQuery },
  { method: "get", path: FilePaths.findText, query: FindTextQuery },
  { method: "get", path: FilePaths.list, query: FileQuery },
  { method: "get", path: ExperimentalPaths.session, query: ExperimentalSessionListQuery },
  { method: "get", path: ExperimentalPaths.tool, query: ToolListQuery },
  { method: "get", path: InstancePaths.vcsDiff, query: VcsDiffQuery },
  { method: "get", path: "/api/session", query: V2SessionsQuery },
  { method: "get", path: "/api/session/:sessionID/message", query: V2MessagesQuery },
] satisfies Array<{ method: Method; path: string; query: QuerySchema }>

const numericSdkQueryParams = [
  { method: "get", path: ExperimentalPaths.session, name: "start", schema: { type: "number" } },
  { method: "get", path: ExperimentalPaths.session, name: "cursor", schema: { type: "number" } },
  { method: "get", path: ExperimentalPaths.session, name: "limit", schema: { type: "number" } },
  { method: "get", path: FilePaths.findFile, name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
  { method: "get", path: SessionPaths.list, name: "start", schema: { type: "number" } },
  { method: "get", path: SessionPaths.list, name: "limit", schema: { type: "number" } },
  {
    method: "get",
    path: SessionPaths.messages,
    name: "limit",
    schema: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
  { method: "get", path: "/api/session", name: "limit", schema: { type: "number" } },
  { method: "get", path: "/api/session", name: "start", schema: { type: "number" } },
  { method: "get", path: "/api/session/:sessionID/message", name: "limit", schema: { type: "number" } },
] satisfies Array<{ method: Method; path: string; name: string; schema: OpenApiSchema }>

function app() {
  return Server.Default().app
}

function request(url: string, init?: RequestInit) {
  return Effect.promise(async () => app().request(url, init))
}

function withTmp<A, E, R>(
  options: Parameters<typeof tmpdir>[0],
  fn: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap(fn))
}

function openApiPath(path: string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
}

function queryParameters(operation: OpenApiOperation | undefined) {
  return (operation?.parameters ?? []).filter((param) => param.in === "query").map((param) => param.name)
}

function queryParameter(operation: OpenApiOperation | undefined, name: string) {
  return (operation?.parameters ?? []).find((param) => param.in === "query" && param.name === name)
}

function assertAdvertisedQueryParamsAreRuntimeFields(input: {
  readonly method: Method
  readonly operation: OpenApiOperation | undefined
  readonly path: string
  readonly query: QuerySchema
}) {
  const runtimeFields = new Set(Object.keys(input.query.fields))
  const advertisedOnly = queryParameters(input.operation).filter((name) => !runtimeFields.has(name))

  expect(
    advertisedOnly,
    `${input.method.toUpperCase()} ${input.path} advertises query params not accepted by runtime schema`,
  ).toEqual([])
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

// Regression for the "OpenAPI advertises ?directory&workspace, runtime
// rejects them" drift class. Each affected route must accept both params
// without 400.
describe("httpapi query schema drift", () => {
  const routingParams = (dir: string) =>
    `directory=${encodeURIComponent(dir)}&workspace=${encodeURIComponent("ws_test")}`

  const expectNotSchemaRejection = (status: number, url: string) => {
    expect(status, `route ${url} 400'd, query schema is missing routing fields`).not.toBe(400)
  }

  it.effect(
    "boolean query schema accepts only true and false strings",
    Effect.sync(() => {
      const decode = Schema.decodeUnknownSync(QueryBoolean)
      const encode = Schema.encodeUnknownSync(QueryBoolean)

      expect(decode("true")).toBe(true)
      expect(decode("false")).toBe(false)
      expect(encode(true)).toBe("true")
      expect(encode(false)).toBe("false")

      for (const input of ["1", "yes", "True", "", true, false]) {
        expect(() => decode(input)).toThrow()
      }
    }),
  )

  it.effect(
    "OpenAPI workspace query params are declared by runtime query schemas",
    Effect.sync(() => {
      const spec = OpenApi.fromApi(PublicApi)
      for (const route of openApiDriftRoutes) {
        assertAdvertisedQueryParamsAreRuntimeFields({
          ...route,
          operation: spec.paths[openApiPath(route.path)]?.[route.method],
        })
      }
    }),
  )

  it.effect(
    "OpenAPI numeric query params preserve generated SDK call shapes",
    Effect.sync(() => {
      const spec = OpenApi.fromApi(PublicApi)
      for (const expected of numericSdkQueryParams) {
        expect(
          queryParameter(spec.paths[openApiPath(expected.path)]?.[expected.method], expected.name)?.schema,
          `${expected.method.toUpperCase()} ${expected.path} ${expected.name}`,
        ).toEqual(expected.schema)
      }
    }),
  )

  it.effect(
    "drift assertion catches spec-only workspace query params",
    Effect.sync(() => {
      expect(() =>
        assertAdvertisedQueryParamsAreRuntimeFields({
          method: "get",
          operation: {
            parameters: [
              { name: "directory", in: "query" },
              { name: "workspace", in: "query" },
            ],
          },
          path: "/fixture",
          query: { fields: {} },
        }),
      ).toThrow("advertises query params not accepted by runtime schema")
    }),
  )

  it.live(
    "session list accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/session?${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "session messages accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/session/${SessionID.descending()}/message?limit=80&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "file find/file accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/find/file?query=foo&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "file find/text accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/find?pattern=foo&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "file read accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/file?path=foo&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "experimental session list accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/experimental/session?${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "experimental tool list accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/experimental/tool?provider=anthropic&model=claude&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "vcs diff accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/vcs/diff?mode=working&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )
})
