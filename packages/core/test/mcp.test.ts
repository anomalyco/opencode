import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { Config } from "@opencode-ai/core/config"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Form } from "@opencode-ai/core/form"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { MCPClient } from "@opencode-ai/core/mcp/client"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { location } from "./fixture/location"
import { settleTool, toolDefinitions, toolIdentity, waitForTool } from "./lib/tool"

let assertion: Deferred.Deferred<PermissionV2.AssertInput> | undefined
let decision: Effect.Effect<void, PermissionV2.Error> = Effect.void
let calls = 0

type ResourcePage = {
  items: Array<{ name: string; uri: string; description?: string; mimeType?: string }>
  nextCursor?: string
}

type ResourceTemplatePage = {
  items: Array<{ name: string; uriTemplate: string; description?: string; mimeType?: string }>
  nextCursor?: string
}

function resourceServer(input: { resources?: boolean; subscribe?: boolean; listChanged?: boolean } = {}) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const state = {
        resources: [] as ResourcePage["items"],
        templates: [] as ResourceTemplatePage["items"],
        resourcePages: undefined as Record<string, ResourcePage> | undefined,
        templatePages: undefined as Record<string, ResourceTemplatePage> | undefined,
        contents: [
          { uri: "docs://readme", text: "hello", mimeType: "text/plain" },
          { uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" },
        ] as Array<{ uri: string; text: string; mimeType?: string } | { uri: string; blob: string; mimeType?: string }>,
        resourceLists: 0,
        templateLists: 0,
        resourceListFailures: 0,
        subscriptionFailures: 0,
        subscriptions: [] as string[],
        unsubscriptions: [] as string[],
        onSubscription: undefined as (() => void | Promise<void>) | undefined,
        onExpiredRequest: undefined as (() => void | Promise<void>) | undefined,
      }
      const makeProtocol = async () => {
        const protocol = new Server(
          { name: "mcp-resources", version: "1.0.0" },
          {
            capabilities: {
              tools: {},
              ...(input.resources === false
                ? {}
                : { resources: { subscribe: input.subscribe, listChanged: input.listChanged } }),
            },
          },
        )
        protocol.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [] }))
        if (input.resources !== false) {
          protocol.setRequestHandler(ListResourcesRequestSchema, (request) => {
            state.resourceLists += 1
            if (state.resourceListFailures > 0) {
              state.resourceListFailures -= 1
              throw new Error("resource list failed")
            }
            const page = state.resourcePages?.[request.params?.cursor ?? "initial"]
            return Promise.resolve({ resources: page?.items ?? state.resources, nextCursor: page?.nextCursor })
          })
          protocol.setRequestHandler(ListResourceTemplatesRequestSchema, (request) => {
            state.templateLists += 1
            const page = state.templatePages?.[request.params?.cursor ?? "initial"]
            return Promise.resolve({ resourceTemplates: page?.items ?? state.templates, nextCursor: page?.nextCursor })
          })
          protocol.setRequestHandler(ReadResourceRequestSchema, () => Promise.resolve({ contents: state.contents }))
          protocol.setRequestHandler(SubscribeRequestSchema, async (request) => {
            state.subscriptions.push(request.params.uri)
            if (state.subscriptionFailures > 0) {
              state.subscriptionFailures -= 1
              throw new Error("resource subscription failed")
            }
            await state.onSubscription?.()
            return {}
          })
          protocol.setRequestHandler(UnsubscribeRequestSchema, (request) => {
            state.unsubscriptions.push(request.params.uri)
            return Promise.resolve({})
          })
        }
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
        })
        await protocol.connect(transport)
        return { protocol, transport }
      }
      let current = await makeProtocol()
      let expiredRequests = 0
      const http = Bun.serve({
        port: 0,
        fetch: async (request) => {
          if (expiredRequests > 0 && request.method === "POST" && request.headers.has("mcp-session-id")) {
            expiredRequests -= 1
            await state.onExpiredRequest?.()
            return new Response("session expired", { status: 404 })
          }
          return current.transport.handleRequest(request)
        },
      })
      return {
        state,
        url: http.url.toString(),
        sendResourceListChanged: () => current.protocol.sendResourceListChanged(),
        sendResourceUpdated: (uri: string) => current.protocol.sendResourceUpdated({ uri }),
        restart: async (requests = 1) => {
          current = await makeProtocol()
          expiredRequests = requests
        },
        close: async () => {
          await current.protocol.close().catch(() => {})
          await http.stop(true)
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

function resourceMcpLayer(url: string, changed: Deferred.Deferred<void>) {
  const directory = AbsolutePath.make(import.meta.dir)
  const unusedIntegration = () => Effect.die("unused integration service")
  let resourceChanges = 0
  return MCP.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  info: new Config.Info({
                    mcp: new ConfigMCP.Info({
                      servers: { resources: new ConfigMCP.Remote({ type: "remote", url, oauth: false }) },
                    }),
                  }),
                }),
              ]),
          }),
        ),
        Layer.succeed(Location.Service, Location.Service.of(location({ directory }))),
        Layer.mock(EventV2.Service, {
          subscribe: () => Stream.never,
          publish: (definition) =>
            Effect.sync(() => {
              if (definition.type === "mcp.resources.changed" && ++resourceChanges === 2)
                Deferred.doneUnsafe(changed, Exit.void)
              return undefined as never
            }),
        }),
        Layer.mock(Form.Service, {}),
        Layer.mock(Integration.Service, {
          connection: {
            active: unusedIntegration,
            resolve: unusedIntegration,
            key: unusedIntegration,
            oauth: unusedIntegration,
            update: unusedIntegration,
            remove: unusedIntegration,
          },
          attempt: {
            status: unusedIntegration,
            complete: unusedIntegration,
            cancel: unusedIntegration,
          },
        }),
        Layer.mock(Credential.Service, {}),
      ),
    ),
  )
}

const mcp = Layer.mock(MCP.Service, {
  tools: () =>
    Effect.succeed([
      new MCP.Tool({
        server: MCP.ServerName.make("demo"),
        name: "search",
        description: "Search",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      }),
    ]),
  callTool: (input) =>
    Effect.sync(() => {
      calls += 1
      return new MCP.ToolResult({
        server: MCP.ServerName.make(input.server),
        tool: input.name,
        isError: false,
        structured: { ok: true },
        content: [],
      })
    }),
})
const permissions = Layer.mock(PermissionV2.Service, {
  assert: (input) =>
    Effect.gen(function* () {
      if (!assertion) return yield* Effect.die("Permission test is not initialized")
      yield* Deferred.succeed(assertion, input)
      yield* decision
    }),
})
const events = Layer.mock(EventV2.Service, { subscribe: () => Stream.never })
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, McpTool.node]), [
    [MCP.node, mcp],
    [PermissionV2.node, permissions],
    [EventV2.node, events],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

describe("MCP errors", () => {
  test("expose useful messages", () => {
    expect(new MCP.NotFoundError({ server: MCP.ServerName.make("demo") }).message).toBe("MCP server not found: demo")
    expect(
      new MCP.ToolCallError({ server: MCP.ServerName.make("demo"), tool: "search", message: "failed" }).message,
    ).toBe("failed")
    expect(new MCPClient.NeedsAuthError({ server: "demo" }).message).toBe("MCP server requires authentication: demo")
    expect(new MCPClient.ConnectError({ server: "demo", message: "offline" }).message).toBe("offline")
  })
})

test("MCP tool names match V1 sanitization", () => {
  expect(McpTool.name("context 7", "resolve.library/id")).toBe("context_7_resolve_library_id")
})

test("preserves output schema validation across paginated tool discovery", async () => {
  const server = new Server({ name: "pagination", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
    Promise.resolve(
      params?.cursor === "page-2"
        ? {
            tools: [
              {
                name: "second",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "number" } },
                  required: ["value"],
                },
              },
            ],
          }
        : {
            tools: [
              {
                name: "first",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                },
              },
            ],
            nextCursor: "page-2",
          },
    ),
  )
  server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
    Promise.resolve({
      content: [],
      structuredContent: { value: params.name === "first" ? 42 : 1 },
    }),
  )

  const client = new Client({ name: "pagination-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const first = await client.listTools()
    const second = await client.listTools({ cursor: first.nextCursor })
    expect([...first.tools, ...second.tools].map((tool) => tool.name)).toEqual(["first", "second"])
    await expect(client.callTool({ name: "first", arguments: {} })).rejects.toThrow(
      "Structured content does not match the tool's output schema",
    )
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})

test("retains output schemas across paginated MCP discovery", async () => {
  const tools = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* MCPClient.connect(
          "pagination",
          new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-output-schema.ts")],
          }),
          import.meta.dir,
        )
        return yield* connection.tools()
      }),
    ),
  )

  expect(tools.map((tool) => ({ name: tool.name, outputSchema: tool.outputSchema }))).toEqual([
    {
      name: "first",
      outputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    },
    {
      name: "second",
      outputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      },
    },
  ])
})

test("applies the configured MCP catalog timeout", async () => {
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* MCPClient.connect(
          "catalog-timeout",
          new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-timeout.ts")],
            environment: { MCP_TIMEOUT_TARGET: "catalog" },
            timeout: new ConfigMCP.Timeout({ catalog: 10 }),
          }),
          import.meta.dir,
        )
        return yield* connection.tools()
      }),
    ),
  )

  await expect(result).rejects.toThrow("Request timed out")
})

test("applies the configured MCP execution timeout", async () => {
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* MCPClient.connect(
          "execution-timeout",
          new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-timeout.ts")],
            timeout: new ConfigMCP.Timeout({ execution: 10 }),
          }),
          import.meta.dir,
        )
        return yield* connection.callTool({ name: "slow" })
      }),
    ),
  )

  await expect(result).rejects.toThrow("Request timed out")
})

test("applies the configured MCP execution timeout to prompts", async () => {
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* MCPClient.connect(
          "prompt-timeout",
          new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-timeout.ts")],
            timeout: new ConfigMCP.Timeout({ execution: 10 }),
          }),
          import.meta.dir,
        )
        return yield* connection.prompt({ name: "slow" })
      }),
    ),
  )

  await expect(result).rejects.toThrow("Request timed out")
})

test("applies configured MCP timeouts to resource operations", async () => {
  const catalog = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* MCPClient.connect(
          "resource-catalog-timeout",
          new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-timeout.ts")],
            environment: { MCP_TIMEOUT_TARGET: "resource-catalog" },
            timeout: new ConfigMCP.Timeout({ catalog: 10 }),
          }),
          import.meta.dir,
        )
        return yield* connection.resources()
      }),
    ),
  )
  await expect(catalog).rejects.toThrow("Request timed out")

  const read = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* MCPClient.connect(
          "resource-read-timeout",
          new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-timeout.ts")],
            timeout: new ConfigMCP.Timeout({ execution: 10 }),
          }),
          import.meta.dir,
        )
        return yield* connection.readResource({ uri: "test://slow" })
      }),
    ),
  )
  await expect(read).rejects.toThrow("Request timed out")
})

test("lists, reads, and invalidates MCP resources", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ listChanged: true })
        server.state.resourcePages = {
          initial: {
            items: [{ name: "Readme", uri: "docs://readme", description: "Project docs" }],
            nextCursor: "resources-2",
          },
          "resources-2": { items: [{ name: "Logo", uri: "docs://logo", mimeType: "image/png" }] },
        }
        server.state.templatePages = {
          initial: {
            items: [{ name: "File", uriTemplate: "docs://{path}" }],
            nextCursor: "templates-2",
          },
          "templates-2": { items: [{ name: "Issue", uriTemplate: "issue://{id}", description: "Issue" }] },
        }
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )

        expect(yield* connection.resources()).toEqual([
          { name: "Readme", uri: "docs://readme", description: "Project docs", mimeType: undefined },
          { name: "Logo", uri: "docs://logo", description: undefined, mimeType: "image/png" },
        ])
        expect(yield* connection.resourceTemplates()).toEqual([
          { name: "File", uriTemplate: "docs://{path}", description: undefined, mimeType: undefined },
          { name: "Issue", uriTemplate: "issue://{id}", description: "Issue", mimeType: undefined },
        ])
        expect(yield* connection.readResource({ uri: "docs://readme" })).toEqual({
          contents: [
            { type: "text", uri: "docs://readme", text: "hello", mimeType: "text/plain" },
            { type: "blob", uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" },
          ],
        })

        const changed = yield* Deferred.make<void>()
        connection.onResourcesChanged(() => Deferred.doneUnsafe(changed, Exit.void))
        yield* Effect.promise(server.sendResourceListChanged)
        yield* Deferred.await(changed)
      }),
    ),
  )
})

test("shares scoped MCP resource subscriptions", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const secondUpdate = yield* Deferred.make<void>()

        expect(
          yield* connection
            .subscribeResource({ uri: "docs://readme" }, () => {
              throw new Error("listener failed")
            })
            .pipe(Scope.provide(firstScope)),
        ).toBe(true)
        expect(
          yield* connection
            .subscribeResource({ uri: "docs://readme" }, () => Deferred.doneUnsafe(secondUpdate, Exit.void))
            .pipe(Scope.provide(secondScope)),
        ).toBe(true)
        expect(server.state.subscriptions).toEqual(["docs://readme"])

        yield* Effect.promise(() => server.sendResourceUpdated("docs://readme"))
        yield* Deferred.await(secondUpdate)
        yield* Scope.close(firstScope, Exit.void)
        expect(server.state.unsubscriptions).toEqual([])
        yield* Scope.close(secondScope, Exit.void)
        expect(server.state.unsubscriptions).toEqual(["docs://readme"])
      }),
    ),
  )
})

test("releases MCP resource subscriptions provided a closed scope", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        const closed = yield* Scope.make()
        yield* Scope.close(closed, Exit.void)
        expect(
          yield* connection
            .subscribeResource({ uri: "docs://readme" }, () => {})
            .pipe(
              Scope.provide(closed),
              Effect.timeoutOrElse({
                duration: "1 second",
                orElse: () => Effect.fail(new Error("closed-scope resource subscription deadlocked")),
              }),
            ),
        ).toBe(true)
        expect(server.state.subscriptions).toEqual(["docs://readme"])
        expect(server.state.unsubscriptions).toEqual(["docs://readme"])
      }),
    ),
  )
})

test("recovers an HTTP session while creating an MCP resource subscription", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        yield* Effect.promise(() => server.restart())

        expect(
          yield* connection
            .subscribeResource({ uri: "docs://readme" }, () => {})
            .pipe(
              Effect.timeoutOrElse({
                duration: "1 second",
                orElse: () => Effect.fail(new Error("session recovery deadlocked")),
              }),
            ),
        ).toBe(true)
        expect(server.state.subscriptions).toEqual(["docs://readme"])
      }),
    ),
  )
})

test("restores an in-flight MCP resource subscription during HTTP session recovery", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        const expired = yield* Deferred.make<void>()
        let expiredRequests = 0
        server.state.onExpiredRequest = () => {
          expiredRequests += 1
          if (expiredRequests === 2) Deferred.doneUnsafe(expired, Exit.void)
          return Effect.runPromise(Deferred.await(expired))
        }
        yield* Effect.promise(() => server.restart(2))

        const [subscribed, resources] = yield* Effect.all(
          [connection.subscribeResource({ uri: "docs://readme" }, () => {}), connection.resources()],
          { concurrency: "unbounded" },
        )
        expect(subscribed).toBe(true)
        expect(resources).toEqual([])
        expect(server.state.subscriptions).toEqual(["docs://readme"])
      }),
    ),
  )
})

test("does not duplicate an MCP resource subscription started during recovery", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        expect(yield* connection.subscribeResource({ uri: "docs://existing" }, () => {})).toBe(true)
        const restorationStarted = yield* Deferred.make<void>()
        const allowRestoration = yield* Deferred.make<void>()
        server.state.onSubscription = () => {
          Deferred.doneUnsafe(restorationStarted, Exit.void)
          return Effect.runPromise(Deferred.await(allowRestoration))
        }
        yield* Effect.promise(() => server.restart())

        const resources = yield* connection.resources().pipe(Effect.forkScoped)
        yield* Deferred.await(restorationStarted)
        const subscription = yield* connection
          .subscribeResource({ uri: "docs://later" }, () => {})
          .pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        yield* Deferred.succeed(allowRestoration, undefined)

        yield* Fiber.join(resources)
        expect(yield* Fiber.join(subscription)).toBe(true)
        expect(server.state.subscriptions).toEqual(["docs://existing", "docs://existing", "docs://later"])
      }),
    ),
  )
})

test("does not create an interrupted MCP resource subscription during recovery", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        const expired = yield* Deferred.make<void>()
        const allowExpired = yield* Deferred.make<void>()
        server.state.onExpiredRequest = () => {
          Deferred.doneUnsafe(expired, Exit.void)
          return Effect.runPromise(Deferred.await(allowExpired))
        }
        yield* Effect.promise(() => server.restart())

        const subscription = yield* connection
          .subscribeResource({ uri: "docs://readme" }, () => {})
          .pipe(Effect.forkScoped)
        yield* Deferred.await(expired)
        yield* Fiber.interrupt(subscription)
        yield* Deferred.succeed(allowExpired, undefined)

        expect(yield* connection.resources()).toEqual([])
        expect(server.state.subscriptions).toEqual([])
      }),
    ),
  )
})

test("restores MCP resource state after HTTP session recovery", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true, listChanged: true })
        server.state.resources = [{ name: "Readme", uri: "docs://readme" }]
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        const changed = yield* Deferred.make<void>()
        const subscriptionScope = yield* Scope.make()
        connection.onResourcesChanged(() => Deferred.doneUnsafe(changed, Exit.void))
        expect(
          yield* connection
            .subscribeResource({ uri: "docs://readme" }, () => {})
            .pipe(Scope.provide(subscriptionScope)),
        ).toBe(true)

        yield* Effect.promise(() => server.restart())
        server.state.resources = [{ name: "Guide", uri: "docs://guide" }]
        const restorationStarted = yield* Deferred.make<void>()
        const allowRestoration = yield* Deferred.make<void>()
        const resourcesLoaded = yield* Deferred.make<void>()
        server.state.onSubscription = () => {
          Deferred.doneUnsafe(restorationStarted, Exit.void)
          return Effect.runPromise(Deferred.await(allowRestoration))
        }
        const resources = yield* connection.resources().pipe(
          Effect.tap(() => Deferred.succeed(resourcesLoaded, undefined)),
          Effect.forkScoped,
        )
        yield* Deferred.await(restorationStarted)
        expect(yield* Deferred.isDone(resourcesLoaded)).toBe(false)
        yield* Deferred.succeed(allowRestoration, undefined)
        expect((yield* Fiber.join(resources)).map((resource) => resource.uri)).toEqual(["docs://guide"])
        yield* Deferred.await(changed)
        expect(server.state.subscriptions).toEqual(["docs://readme", "docs://readme"])
        yield* Scope.close(subscriptionScope, Exit.void)
      }),
    ),
  )
})

test("skips unsupported MCP resource subscriptions", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer()
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        expect(yield* connection.subscribeResource({ uri: "docs://readme" }, () => {})).toBe(false)
        expect(server.state.subscriptions).toEqual([])
      }),
    ),
  )
})

test("closes an MCP connection when subscription restoration fails", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ subscribe: true })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        const closed = yield* Deferred.make<void>()
        connection.onClose(() => Deferred.doneUnsafe(closed, Exit.void))
        expect(yield* connection.subscribeResource({ uri: "docs://readme" }, () => {})).toBe(true)
        yield* Effect.promise(() => server.restart())
        server.state.subscriptionFailures = 1

        expect(Exit.isFailure(yield* connection.resources().pipe(Effect.exit))).toBe(true)
        yield* Deferred.await(closed)
      }),
    ),
  )
})

test("skips MCP resource requests when the capability is absent", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ resources: false })
        const connection = yield* MCPClient.connect(
          "resources",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }),
          import.meta.dir,
        )
        expect(yield* connection.resources()).toEqual([])
        expect(yield* connection.resourceTemplates()).toEqual([])
        expect(yield* connection.readResource({ uri: "docs://readme" })).toBeUndefined()
        expect({ resources: server.state.resourceLists, templates: server.state.templateLists }).toEqual({
          resources: 0,
          templates: 0,
        })
      }),
    ),
  )
})

test("caches and invalidates MCP resource catalogs", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ listChanged: true, subscribe: true })
        server.state.resources = [{ name: "Readme", uri: "docs://readme" }]
        server.state.templates = [{ name: "File", uriTemplate: "docs://{path}" }]
        server.state.resourceListFailures = 1
        const changed = yield* Deferred.make<void>()

        yield* Effect.gen(function* () {
          const service = yield* MCP.Service
          expect(yield* service.resourceCatalog()).toEqual({
            resources: [],
            templates: [
              {
                server: "resources",
                name: "File",
                uriTemplate: "docs://{path}",
                description: undefined,
                mimeType: undefined,
              },
            ],
          })
          expect((yield* service.resourceCatalog()).resources).toEqual([
            {
              server: "resources",
              name: "Readme",
              uri: "docs://readme",
              description: undefined,
              mimeType: undefined,
            },
          ])
          yield* service.resourceCatalog()
          expect({ resources: server.state.resourceLists, templates: server.state.templateLists }).toEqual({
            resources: 2,
            templates: 1,
          })

          server.state.resources = [{ name: "Guide", uri: "docs://guide" }]
          yield* Effect.promise(server.sendResourceListChanged)
          yield* Deferred.await(changed)
          expect((yield* service.resourceCatalog()).resources.map((resource) => resource.uri)).toEqual(["docs://guide"])
          expect({ resources: server.state.resourceLists, templates: server.state.templateLists }).toEqual({
            resources: 3,
            templates: 2,
          })
          expect(yield* service.readResource({ server: "resources", uri: "docs://readme" })).toEqual({
            server: "resources",
            uri: "docs://readme",
            contents: [
              { type: "text", uri: "docs://readme", text: "hello", mimeType: "text/plain" },
              { type: "blob", uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" },
            ],
          })
        }).pipe(Effect.provide(resourceMcpLayer(server.url, changed)))
      }),
    ),
  )
})

test("reloads an MCP resource catalog when its HTTP session recovers", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ listChanged: true })
        const changed = yield* Deferred.make<void>()

        yield* Effect.gen(function* () {
          const service = yield* MCP.Service
          yield* service.tools()
          yield* Effect.promise(() => server.restart())
          server.state.resources = [{ name: "Guide", uri: "docs://guide" }]

          expect((yield* service.resourceCatalog()).resources.map((resource) => resource.uri)).toEqual(["docs://guide"])
        }).pipe(Effect.provide(resourceMcpLayer(server.url, changed)))
      }),
    ),
  )
})

it.effect("advertises MCP output schemas to Code Mode", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    yield* waitForTool(registry, "execute")
    const execute = (yield* toolDefinitions(registry)).find((tool) => tool.name === "execute")

    expect(execute?.description).toContain("tools.demo.search(input: {}): Promise<{\n  ok: boolean,\n}>")
  }),
)

it.effect("waits for permission before calling an MCP tool", () =>
  Effect.gen(function* () {
    calls = 0
    assertion = yield* Deferred.make<PermissionV2.AssertInput>()
    const permission = yield* Deferred.make<void>()
    decision = Deferred.await(permission)
    const registry = yield* ToolRegistry.Service
    yield* waitForTool(registry, "execute")

    const fiber = yield* settleTool(registry, {
      sessionID: SessionV2.ID.make("ses_mcp_permission"),
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_mcp_permission",
        name: "execute",
        input: { code: "return await tools.demo.search({})" },
      },
    }).pipe(Effect.forkScoped)
    expect(yield* Deferred.await(assertion)).toEqual({
      action: "demo_search",
      resources: ["*"],
      save: ["*"],
      metadata: {},
      sessionID: SessionV2.ID.make("ses_mcp_permission"),
      agent: toolIdentity.agent,
      source: {
        type: "tool",
        messageID: toolIdentity.assistantMessageID,
        callID: "call_mcp_permission",
      },
    })
    expect(calls).toBe(0)

    yield* Deferred.succeed(permission, undefined)
    yield* Fiber.join(fiber)
    expect(calls).toBe(1)
  }),
)

it.effect("does not call MCP when permission is blocked", () =>
  Effect.gen(function* () {
    calls = 0
    assertion = yield* Deferred.make<PermissionV2.AssertInput>()
    decision = Effect.fail(new PermissionV2.BlockedError({ rules: [], permission: "demo_search", resources: ["*"] }))
    const registry = yield* ToolRegistry.Service
    yield* waitForTool(registry, "execute")

    const settlement = yield* settleTool(registry, {
      sessionID: SessionV2.ID.make("ses_mcp_blocked"),
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_mcp_blocked",
        name: "execute",
        input: { code: "return await tools.demo.search({})" },
      },
    })
    expect(settlement.result).toEqual({ type: "text", value: "Unable to execute demo_search" })
    expect(settlement.output?.structured).toEqual({
      toolCalls: [{ tool: "demo.search", status: "error" }],
      error: true,
    })
    expect(calls).toBe(0)
  }),
)
