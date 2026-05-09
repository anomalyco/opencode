import { afterEach, describe, expect, test } from "bun:test"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { McpPaths } from "../../src/server/routes/instance/httpapi/groups/mcp"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const context = Context.empty() as Context.Context<unknown>
const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))

function app(experimental: boolean) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}
type TestApp = ReturnType<typeof app>

function request(route: string, directory: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", directory)
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

function withMcpProject<A, E, R>(self: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-test-" })

    yield* fs.writeFileString(
      path.join(dir, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        formatter: false,
        lsp: false,
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        WithInstance.provide({ directory: dir, fn: () => InstanceRuntime.disposeInstance(Instance.current) }),
      ).pipe(Effect.ignore),
    )

    return yield* self(dir).pipe(provideInstance(dir))
  })
}

const readResponse = Effect.fnUntraced(function* (input: { app: TestApp; path: string; headers: HeadersInit }) {
  const response = yield* Effect.promise(() =>
    Promise.resolve(input.app.request(input.path, { method: "POST", headers: input.headers })),
  )
  return {
    status: response.status,
    body: yield* Effect.promise(() => response.text()),
  }
})

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

describe("mcp HttpApi", () => {
  test("serves status endpoint", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const response = await request(McpPaths.status, tmp.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ demo: { status: "disabled" } })
  })

  test("serves add, connect, and disconnect endpoints", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const added = await request(McpPaths.status, tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "added",
        config: {
          type: "local",
          command: ["echo", "added"],
          enabled: false,
        },
      }),
    })
    expect(added.status).toBe(200)
    expect(await added.json()).toMatchObject({ added: { status: "disabled" } })

    const connected = await request("/mcp/demo/connect", tmp.path, { method: "POST" })
    expect(connected.status).toBe(200)
    expect(await connected.json()).toBe(true)

    const disconnected = await request("/mcp/demo/disconnect", tmp.path, { method: "POST" })
    expect(disconnected.status).toBe(200)
    expect(await disconnected.json()).toBe(true)
  })

  test("serves deterministic OAuth endpoints", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const start = await request("/mcp/demo/auth", tmp.path, { method: "POST" })
    expect(start.status).toBe(400)

    const authenticate = await request("/mcp/demo/auth/authenticate", tmp.path, { method: "POST" })
    expect(authenticate.status).toBe(400)

    const removed = await request("/mcp/demo/auth", tmp.path, { method: "DELETE" })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ success: true })
  })

  it.live(
    "matches legacy unsupported OAuth error responses",
    withMcpProject((dir) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": dir }
        const legacy = app(false)
        const httpapi = app(true)

        yield* Effect.forEach(["/mcp/demo/auth", "/mcp/demo/auth/authenticate"], (path) =>
          Effect.gen(function* () {
            const legacyResponse = yield* readResponse({ app: legacy, path, headers })
            const httpapiResponse = yield* readResponse({ app: httpapi, path, headers })

            expect(legacyResponse).toEqual({
              status: 400,
              body: JSON.stringify({ error: "MCP server demo does not support OAuth" }),
            })
            expect(httpapiResponse).toEqual(legacyResponse)
          }),
        )
      }),
    ),
  )
})
