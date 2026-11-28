import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import FastCheck from "fast-check"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Environment } from "@opencode/core/environment/index"
import { EnvironmentUnavailable } from "@opencode/core/environment/unavailable"
import { McpTarget } from "@opencode/core/mcp/target"
import { Effect, Fiber, Layer, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { serve, type Era, type Fixture } from "./fixture/http"
import { README, type Spec } from "./fixture/server"
import { remote, stdio, until, world, type Place } from "./harness"

const it = testEffect(Layer.empty)

const hold = () => new Promise<Response>(() => {})
const rpc = (id: unknown, result: Record<string, unknown>) => Response.json({ jsonrpc: "2.0", id, result })
const rpcError = (id: unknown, code: number, message: string, status = 200) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status })
const params = (body: Record<string, unknown> | undefined) => (body?.params ?? {}) as Record<string, unknown>

// Servers in the wild that bend the protocol, each against one Location connected over HTTP.
const quirks: ReadonlyArray<{
  readonly name: string
  readonly server: Spec & { readonly era: Era }
  readonly config?: Partial<ConfigMCP.Remote>
  readonly intercept?: (server: Fixture) => Parameters<Fixture["intercept"]>[0]
  readonly check: (place: Place, server: Fixture) => Effect.Effect<void, unknown, Scope.Scope>
}> = [
  {
    // Spring AI answers methods it has no handler for, the version probe included, with a 500.
    name: "a server that answers the version probe with HTTP 500 speaks legacy",
    server: { era: "legacy" },
    intercept: () => (_, body) =>
      body?.method === "server/discover" ? new Response("Missing handler", { status: 500 }) : undefined,
    check: (place, server) =>
      Effect.gen(function* () {
        expect(yield* place.status("fixture")).toEqual({ status: "connected" })
        expect([server.seen.discovers, server.seen.initializations]).toEqual([1, 1])
      }),
  },
  {
    name: "a legacy server that answers a missing method with 404 keeps its session (#60583)",
    server: { era: "legacy" },
    intercept: () => (_, body) =>
      body?.method === "resources/templates/list" ? rpcError(body.id, -32601, "Method not found", 404) : undefined,
    check: (place, server) =>
      Effect.gen(function* () {
        expect((yield* place.mcp.resources({ server: "fixture" })).templates).toEqual([])
        yield* place.mcp.callTool({ server: "fixture", name: "echo" })
        expect([server.seen.initializations, server.seen.sessions.size]).toEqual([1, 1])
      }),
  },
  {
    name: "a modern tool call whose mirrored header went stale relists and retries once",
    server: { era: "modern" },
    intercept: (server) => (request, body) => {
      if (body?.method === "tools/list")
        return rpc(body.id, {
          resultType: "complete",
          ttlMs: 0,
          cacheScope: "private",
          tools: [
            {
              name: "echo",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string", "x-mcp-header": server.seen.lists > 1 ? "Zone" : "Region" } },
              },
            },
          ],
        })
      if (body?.method === "tools/call" && request.headers.get("mcp-param-zone") !== "eu")
        return rpcError(body.id, -32020, "Header mismatch", 400)
    },
    check: (place, server) =>
      Effect.gen(function* () {
        yield* place.mcp.callTool({ server: "fixture", name: "echo", args: { text: "eu" } })
        expect([server.seen.lists, server.seen.calls.length]).toEqual([2, 2])
      }),
  },
  {
    name: "a server without resources is never asked for them",
    server: { era: "legacy", resources: false },
    check: (place, server) =>
      Effect.gen(function* () {
        expect(yield* place.mcp.resourceCatalog()).toEqual({ resources: [], templates: [] })
        expect(yield* place.mcp.readResource({ server: "fixture", uri: README.uri })).toBeUndefined()
        expect(server.seen.methods.filter((method) => method.startsWith("resources/"))).toEqual([])
      }),
  },
  {
    name: "resources still list when template listing is not implemented",
    server: { era: "modern" },
    intercept: () => (_, body) =>
      body?.method === "resources/templates/list" ? rpcError(body.id, -32601, "Method not found") : undefined,
    check: (place) =>
      Effect.gen(function* () {
        const catalog = yield* place.mcp.resourceCatalog()
        expect([catalog.resources.map((resource) => resource.uri), catalog.templates]).toEqual([[README.uri], []])
      }),
  },
  {
    // One unusable tool must not hide the others. Fields of the wrong type are dropped, not the tool.
    name: "unusable tools are skipped and malformed fields dropped",
    server: { era: "legacy" },
    intercept: () => (_, body) =>
      body?.method === "tools/list"
        ? rpc(body.id, {
            tools: [
              null,
              "not-a-tool",
              { inputSchema: { type: "object" } },
              { name: "no-schema" },
              { name: "string-schema", inputSchema: { type: "string" } },
              { name: "bad-required", inputSchema: { type: "object", required: "text" } },
              {
                name: "bad-fields",
                title: 1,
                description: 2,
                outputSchema: "x",
                annotations: "x",
                execution: true,
                _meta: [],
                inputSchema: { type: "object" },
              },
              {
                name: "full",
                title: "Full",
                inputSchema: { type: "object" },
                outputSchema: { anyOf: [{ type: "object" }, { type: "string" }] },
                annotations: { readOnlyHint: true },
                _meta: { "example/key": 1 },
                icons: [{ src: "https://example.com/icon.png" }],
              },
            ],
          })
        : undefined,
    check: (place) =>
      Effect.gen(function* () {
        expect((yield* place.mcp.tools()).map(({ server: _, ...tool }) => tool)).toEqual([
          { name: "bad-fields", inputSchema: { type: "object" } },
          { name: "bad-required", inputSchema: { type: "object" } },
          {
            name: "full",
            title: "Full",
            inputSchema: { type: "object" },
            outputSchema: { anyOf: [{ type: "object" }, { type: "string" }] },
            annotations: { readOnlyHint: true },
            _meta: { "example/key": 1 },
          },
        ])
      }),
  },
  {
    // Zoom's meeting_delete declares an object and returns nothing for the REST API's 204.
    name: "results that miss the tool's output schema still succeed",
    server: { era: "modern" },
    intercept: () => (_, body) =>
      body?.method === "tools/list"
        ? rpc(body.id, {
            resultType: "complete",
            ttlMs: 0,
            cacheScope: "private",
            tools: [
              {
                name: "echo",
                inputSchema: { type: "object" },
                outputSchema: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
              },
            ],
          })
        : undefined,
    check: (place) =>
      Effect.gen(function* () {
        expect(yield* place.mcp.callTool({ server: "fixture", name: "echo", args: { text: "Deleted" } })).toMatchObject(
          {
            isError: false,
            content: [{ type: "text", text: "Deleted" }],
          },
        )
      }),
  },
  {
    name: "a tool that asks for more scope fails alone and leaves the server connected",
    server: { era: "modern" },
    config: { oauth: undefined },
    intercept: () => (request, body) =>
      body?.method === "tools/call" && (params(body).arguments as { n?: number } | undefined)?.n === 2
        ? new Response(null, {
            status: 403,
            headers: {
              "WWW-Authenticate": `Bearer error="insufficient_scope", scope="admin", resource_metadata="${new URL(request.url).origin}/prm"`,
            },
          })
        : undefined,
    check: (place) =>
      Effect.gen(function* () {
        yield* place.mcp.callTool({ server: "fixture", name: "echo", args: { n: 2 } }).pipe(Effect.flip)
        yield* place.mcp.callTool({ server: "fixture", name: "echo", args: { n: 3 } })
        expect(yield* place.status("fixture")).toEqual({ status: "connected" })
      }),
  },
  {
    name: "a legacy URL elicitation settles when the server says it finished",
    server: { era: "legacy" },
    check: (place, server) =>
      Effect.gen(function* () {
        const call = yield* place.mcp.callTool({ server: "fixture", name: "confirm" }).pipe(Effect.forkScoped)
        const [form] = yield* until("the form", place.forms.list(), (forms) => forms.length === 1)
        yield* server.complete(String((form!.metadata as { elicitationID: string }).elicitationID))
        expect((yield* Fiber.join(call)).structured).toEqual({ action: "accept" })
        expect(yield* place.forms.state(form!.id)).toEqual({ status: "answered", answer: { elicitation: true } })
      }),
  },
  ...(["catalog", "tools/call", "prompts/get", "resources/read"] as const).map((method) => ({
    name: `a server that never answers ${method} times out`,
    server: { era: "modern" as const },
    config: { timeout: method === "catalog" ? { catalog: 10 } : { execution: 10 } },
    intercept: () => (_: Request, body: Record<string, unknown> | undefined) =>
      body?.method === (method === "catalog" ? "tools/list" : method) ? hold() : undefined,
    check: (place: Place) =>
      Effect.gen(function* () {
        const outcome =
          method === "catalog"
            ? place.status("fixture").pipe(Effect.map((status) => (status?.status === "failed" ? status.error : "")))
            : Effect.flip<unknown, Error, never>(
                method === "tools/call"
                  ? place.mcp.callTool({ server: "fixture", name: "echo" })
                  : method === "prompts/get"
                    ? place.mcp.prompt({ server: "fixture", name: "greet", args: { name: "x" } })
                    : place.mcp.readResource({ server: "fixture", uri: README.uri }),
              ).pipe(Effect.map((error) => error.message))
        expect(yield* outcome).toContain("Request timed out")
      }),
  })),
]

describe("MCP protocol quirks", () => {
  for (const row of quirks)
    it.live(row.name, () =>
      Effect.gen(function* () {
        const server = yield* serve(row.server)
        if (row.intercept) server.intercept(row.intercept(server))
        const place = yield* (yield* world).open({ servers: { fixture: remote(server.url, row.config) } })
        yield* place.settled("fixture")
        yield* row.check(place, server)
      }),
    )

  // Overloaded or restarting servers usually recover within a second; nothing else is worth a second try.
  for (const [status, attempts] of [
    [503, 3],
    [429, 3],
    [501, 1],
    [403, 1],
  ] as const)
    it.effect(`HTTP ${status} at connect is tried ${attempts === 1 ? "once" : `${attempts} times`}`, () =>
      Effect.gen(function* () {
        const server = yield* serve({ era: "modern" })
        server.intercept(() => new Response(null, { status }))
        const place = yield* (yield* world).open({ servers: { fixture: remote(server.url) } })
        while ((yield* place.status("fixture"))?.status === "pending") {
          yield* Effect.promise(() => Bun.sleep(1))
          // Only between attempts, so the connect deadline can't run out under a slow reply.
          if (!server.busy()) yield* TestClock.adjust("100 millis")
        }
        expect((yield* place.status("fixture"))?.status).toBe("failed")
        expect(server.seen.discovers).toBe(attempts)
      }),
    )

  it.live("a stdio server that ignores the version probe speaks legacy", () =>
    Effect.gen(function* () {
      // The probe waits out the startup timeout before falling back; Windows needs room to start Bun.
      const config = stdio({ era: "legacy", silent: true } as Spec & { era: "legacy" }, { timeout: { startup: 1_000 } })
      const place = yield* (yield* world).open({ servers: { fixture: config } })
      expect(yield* place.settled("fixture")).toEqual({ status: "connected" })
    }),
  )

  it.live("a local server runs in its cwd, resolved from the Location, with its environment", () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      yield* Effect.promise(() => fs.mkdir(path.join(directory, "server")))
      // A relative pid file lands in the process's working directory.
      const config = stdio({ era: "modern" }, { cwd: "server", pids: "pids" })
      const place = yield* (yield* world).open({ directory, servers: { fixture: config } })
      expect(yield* place.settled("fixture")).toEqual({ status: "connected" })
      expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "server", "pids"), "utf8"))).toMatch(
        /^\d+\n$/,
      )
    }),
  )

  it.live("a Location without an execution plane fails its local servers", () =>
    Effect.gen(function* () {
      const environment = Layer.succeed(
        Environment.Service,
        Environment.Service.of({
          id: Environment.localID,
          local: false,
          path,
          files: Environment.makeFiles(Environment.makeMemoryDriver()),
          spawner: EnvironmentUnavailable.spawner,
        }),
      )
      const place = yield* (yield* world).open({ environment, servers: { fixture: stdio({ era: "modern" }) } })
      expect(yield* place.settled("fixture")).toEqual({
        status: "failed",
        error: expect.stringContaining("no execution plane"),
      })
    }),
  )
})

describe("MCP config boundary", () => {
  test.each([
    ["https://mcp.example.com/mcp", undefined, "https://mcp.example.com/mcp?codemode=false"],
    ["https://mcp.example.com/mcp", false, undefined],
    ["https://mcp.example.com/mcp?codemode=true", undefined, undefined],
    ["https://gmailmcp.googleapis.com/mcp", undefined, undefined],
    ["https://mcp.zohomcp.eu/mcp", undefined, undefined],
    ["http://127.0.0.1:3845/mcp", undefined, undefined],
  ] as const)("dials %s with codemode %s at %s", (url, codemode, dialed) => {
    expect(McpTarget.dialUrl(new URL(url), codemode)?.href).toBe(dialed)
  })

  test("names the configured URL as the resource even when a server echoes the dialed query", () => {
    const configured = new URL("https://mcp.example.com/mcp?team=1")
    expect(
      McpTarget.withoutDialParams(new URL("https://mcp.example.com/mcp?team=1&codemode=false"), configured).href,
    ).toBe(configured.href)
    expect(McpTarget.withoutDialParams(new URL("https://other.example.com/mcp?codemode=false"), configured).href).toBe(
      "https://other.example.com/mcp?codemode=false",
    )
  })

  // Odd but schema-valid configs only fail their own server; nothing they hold dials out or runs.
  const odd = FastCheck.oneof(
    FastCheck.record({
      type: FastCheck.constant("remote" as const),
      url: FastCheck.constantFrom("", "not a url", "http://[::1", "http://127.0.0.1:1/mcp"),
      oauth: FastCheck.constantFrom(
        undefined,
        false as const,
        {},
        { redirect_uri: "" },
        { redirect_uri: "not a url" },
        { auth_server_metadata_url: "::" },
      ),
      headers: FastCheck.constantFrom(undefined, {}, { "": "" }, { "x-a": "\n" }),
      protocol: FastCheck.constantFrom(undefined, "legacy" as const, "2026-07-28" as const),
      timeout: FastCheck.constantFrom(undefined, {}, { startup: 1 }),
      pool: FastCheck.boolean(),
      disabled: FastCheck.constantFrom(undefined, false, true),
    }),
    FastCheck.record({
      type: FastCheck.constant("local" as const),
      command: FastCheck.constantFrom(
        [],
        [""],
        ["opencode-missing-mcp-server"],
        ["opencode-missing-mcp-server", "--x"],
      ),
      cwd: FastCheck.constantFrom(undefined, "", "~", "../..", "missing"),
      environment: FastCheck.constantFrom(undefined, {}, { "": "" }),
      pool: FastCheck.boolean(),
    }),
  )

  it.live("settles every odd server without touching the others", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const place = yield* (yield* world).open({ servers: { fixture: remote(server.url) } })
      yield* place.settled("fixture")
      const configs = FastCheck.sample(odd, { numRuns: 40, seed: 66931 })
      for (const [index, config] of configs.entries())
        yield* place.mcp.add(`odd${index}`, config as typeof ConfigMCP.Server.Type)
      for (const index of configs.keys()) {
        const status = yield* place.settled(`odd${index}`)
        expect(["failed", "needs_auth", "disabled"]).toContain(status?.status ?? "missing")
      }
      expect(yield* place.status("fixture")).toEqual({ status: "connected" })
      yield* place.mcp.callTool({ server: "fixture", name: "echo" })
    }),
  )

  it.live("reports what is wrong with a config that can't be used", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern" })
      const place = yield* (yield* world).open({})
      const cases = [
        [new ConfigMCP.Remote({ type: "remote", url: "not a url" }), "Invalid MCP server URL: not a url"],
        [new ConfigMCP.Local({ type: "local", command: [] }), "MCP server command is empty"],
        [remote(server.url, { oauth: { redirect_uri: "not a url" } }), "Invalid MCP OAuth redirect_uri: not a url"],
        [
          remote(server.url, { oauth: { auth_server_metadata_url: "::" } }),
          "Invalid MCP OAuth auth_server_metadata_url: ::",
        ],
      ] as const
      for (const [index, [config, error]] of cases.entries()) {
        yield* place.mcp.add(`bad${index}`, config)
        expect(yield* place.settled(`bad${index}`)).toEqual({ status: "failed", error })
        expect((yield* place.mcp.servers()).find((item) => item.name === `bad${index}`)?.integrationID).toBeUndefined()
      }
      // An empty redirect_uri counts as unset, as an unset {env:VAR} substitutes one.
      yield* place.mcp.add("unset", remote(server.url, { oauth: { redirect_uri: "" } }))
      expect(yield* place.settled("unset")).toEqual({ status: "connected" })
      // Fixing the config connects it.
      yield* place.mcp.add("bad0", remote(server.url))
      expect(yield* place.settled("bad0")).toEqual({ status: "connected" })
    }),
  )
})
