import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Document, Event, Info } from "@opencode-ai/schema/config"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import { Config } from "@opencode-ai/core/config"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { ID, type Payload } from "@opencode-ai/schema/event"
import { Form } from "@opencode-ai/core/form"
import { Integration } from "@opencode-ai/core/integration"
import { Environment } from "@opencode-ai/core/environment/index"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { MCPClient } from "@opencode-ai/core/mcp/client"
import { MCPStdio } from "@opencode-ai/core/mcp/stdio"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { Tool } from "@opencode-ai/core/tool"
import { DateTime, Deferred, Effect, Exit, Fiber, Layer, PubSub, Schedule, Schema, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ExitCode, makeHandle, ProcessId } from "effect/unstable/process/ChildProcessSpawner"
import { Image } from "@opencode-ai/core/image"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { location } from "./fixture/location"
import { hostEnvironmentLayer, recordingEnvironmentLayer } from "./fixture/environment"
import { executeTool, toolDefinitions, toolIdentity, waitForCodeModeTool, waitForTool } from "./lib/tool"

let assertion: Deferred.Deferred<Permission.AssertInput> | undefined
let decision: Effect.Effect<void, Permission.Error> = Effect.void
let calls = 0

type ResourcePage = {
  items: Array<{ name: string; uri: string; description?: string; mimeType?: string }>
  nextCursor?: string
}

type ResourceTemplatePage = {
  items: Array<{ name: string; uriTemplate: string; description?: string; mimeType?: string }>
  nextCursor?: string
}

function resourceServer(
  input: { resources?: boolean; listChanged?: boolean; emptyElicitation?: boolean; urlElicitation?: boolean } = {},
) {
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
        toolLists: 0,
        initializations: 0,
      }
      const protocol = new Server(
        { name: "mcp-resources", version: "1.0.0" },
        {
          capabilities: {
            tools: {},
            ...(input.resources === false ? {} : { resources: { listChanged: input.listChanged } }),
          },
        },
      )
      protocol.setRequestHandler(ListToolsRequestSchema, () => {
        state.toolLists += 1
        return Promise.resolve({
          tools: input.emptyElicitation
            ? [{ name: "empty-elicitation", inputSchema: { type: "object" as const, properties: {} } }]
            : input.urlElicitation
              ? [{ name: "url-elicitation", inputSchema: { type: "object" as const, properties: {} } }]
              : [],
        })
      })
      if (input.emptyElicitation) {
        protocol.setRequestHandler(CallToolRequestSchema, async () => {
          const result = await protocol.elicitInput({
            mode: "form",
            message: "Confirm",
            requestedSchema: { type: "object", properties: {} },
          })
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          }
        })
      }
      if (input.urlElicitation) {
        protocol.setRequestHandler(CallToolRequestSchema, async () => {
          const result = await protocol.elicitInput({
            mode: "url",
            message: "Authorize access",
            url: "https://example.com/authorize",
            elicitationId: "elicitation-test",
          })
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          }
        })
      }
      if (input.resources !== false) {
        protocol.setRequestHandler(ListResourcesRequestSchema, (request) => {
          state.resourceLists += 1
          const page = state.resourcePages?.[request.params?.cursor ?? "initial"]
          return Promise.resolve({ resources: page?.items ?? state.resources, nextCursor: page?.nextCursor })
        })
        protocol.setRequestHandler(ListResourceTemplatesRequestSchema, (request) => {
          state.templateLists += 1
          const page = state.templatePages?.[request.params?.cursor ?? "initial"]
          return Promise.resolve({ resourceTemplates: page?.items ?? state.templates, nextCursor: page?.nextCursor })
        })
        protocol.setRequestHandler(ReadResourceRequestSchema, () => Promise.resolve({ contents: state.contents }))
      }
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await protocol.connect(transport)
      const http = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const body: unknown = request.method === "POST" ? await request.clone().json() : undefined
          if (typeof body === "object" && body !== null && "method" in body && body.method === "initialize") {
            state.initializations += 1
          }
          return transport.handleRequest(request)
        },
      })
      return {
        state,
        url: http.url.toString(),
        clientVersion: () => protocol.getClientVersion(),
        sendResourceListChanged: () => protocol.sendResourceListChanged(),
        completeElicitation: () => protocol.createElicitationCompletionNotifier("elicitation-test")(),
        close: async () => {
          await protocol.close().catch(() => {})
          await http.stop(true)
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

function resourceMcpLayer(
  server: string | typeof ConfigMCP.Server.Type,
  onFormCreated?: (form: Form.Info) => Effect.Effect<void>,
  options?: MCP.Options,
  overrides?: {
    entries?: Config.Interface["entries"]
    subscribe?: Bus.Interface["subscribe"]
    environment?: Layer.Layer<Environment.Service>
  },
) {
  const directory = AbsolutePath.make(import.meta.dir)
  const unusedIntegration = () => Effect.die("unused integration service")
  return MCP.layer(options).pipe(
    Layer.provideMerge(Form.layer),
    Layer.provide(
      Layer.mergeAll(
        overrides?.entries
          ? Layer.succeed(
              Config.Service,
              Config.Service.of({ entries: overrides.entries, changes: () => Stream.never }),
            )
          : Config.testLayer([
              new Document({
                type: "document",
                info: new Info({
                  mcp: new ConfigMCP.Info({
                    servers: {
                      resources:
                        typeof server === "string"
                          ? new ConfigMCP.Remote({ type: "remote", url: server, oauth: false })
                          : server,
                    },
                  }),
                }),
              }),
            ]),
        Layer.succeed(Location.Service, Location.Service.of(location({ directory }))),
        Layer.mock(Bus.Service, {
          subscribe: overrides?.subscribe ?? (() => Stream.never),
          publish: (definition, data) => {
            const event = {
              id: ID.create(),
              type: definition.type,
              data,
            } as Payload<typeof definition>
            if (event.type !== Form.Event.Created.type || !onFormCreated) return Effect.succeed(event)
            return onFormCreated(Schema.decodeUnknownSync(Form.Event.Created.data)(data).form).pipe(Effect.as(event))
          },
        }),
        Layer.mock(Integration.Service, {
          connection: {
            active: unusedIntegration,
            resolve: unusedIntegration,
            key: unusedIntegration,
            update: unusedIntegration,
            remove: unusedIntegration,
          },
          oauth: {
            connect: unusedIntegration,
            status: unusedIntegration,
            complete: unusedIntegration,
            cancel: unusedIntegration,
          },
          command: {
            connect: unusedIntegration,
            status: unusedIntegration,
            cancel: unusedIntegration,
          },
        }),
        Layer.mock(Credential.Service, {}),
        overrides?.environment ?? hostEnvironmentLayer,
      ),
    ),
  )
}

const connect = (server: string, config: typeof ConfigMCP.Server.Type, directory: string) =>
  MCPClient.connect(server, config, directory).pipe(Effect.provide(hostEnvironmentLayer))

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
      new MCP.Tool({
        server: MCP.ServerName.make("demo"),
        name: "status",
        description: "Status",
        inputSchema: { type: "object", properties: {} },
      }),
      new MCP.Tool({
        server: MCP.ServerName.make("direct"),
        name: "lookup",
        codemode: false,
        description: "Lookup",
        inputSchema: { type: "object", properties: {} },
      }),
      new MCP.Tool({
        server: MCP.ServerName.make("direct"),
        name: "fail",
        codemode: false,
        description: "Always fails",
        inputSchema: { type: "object", properties: {} },
      }),
      new MCP.Tool({
        server: MCP.ServerName.make("direct"),
        name: "media",
        codemode: false,
        description: "Returns text and an image",
        inputSchema: { type: "object", properties: {} },
      }),
    ]),
  callTool: (input) =>
    Effect.sync(() => {
      calls += 1
      if (input.name === "fail")
        return new MCP.ToolResult({
          server: MCP.ServerName.make(input.server),
          tool: input.name,
          isError: true,
          content: [{ type: "text", text: "search index unavailable" }],
        })
      if (input.name === "media")
        return new MCP.ToolResult({
          server: MCP.ServerName.make(input.server),
          tool: input.name,
          isError: false,
          content: [
            { type: "text", text: "rendered chart" },
            { type: "media", data: "aGVsbG8=", mimeType: "image/png" },
          ],
        })
      if (input.name === "status")
        return new MCP.ToolResult({
          server: MCP.ServerName.make(input.server),
          tool: input.name,
          isError: false,
          content: [{ type: "text", text: "hello" }],
        })
      return new MCP.ToolResult({
        server: MCP.ServerName.make(input.server),
        tool: input.name,
        isError: false,
        structured: { ok: true },
        content: [],
      })
    }),
})
const permissions = Layer.mock(Permission.Service, {
  assert: (input) =>
    Effect.gen(function* () {
      if (!assertion) return yield* Effect.die("Permission test is not initialized")
      yield* Deferred.succeed(assertion, input)
      yield* decision
    }),
})
const events = Layer.mock(Bus.Service, { subscribe: () => Stream.never })
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node]), [
    [MCP.node, mcp],
    [Permission.node, permissions],
    [Bus.node, events],
    [Image.node, imagePassthrough],
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
  expect(McpTool.namespace("context 7")).toBe("context_7")
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
        const connection = yield* connect(
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

test("spawns local MCP servers through the location environment", async () => {
  const spawns: Array<ChildProcess.Command> = []
  const cwd = path.join(import.meta.dir, "fixture")
  const config = new ConfigMCP.Local({
    type: "local",
    command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-output-schema.ts")],
    cwd: "fixture",
    environment: { MCP_LOCATION_TEST: "configured" },
  })

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* MCPClient.connect("environment", config, import.meta.dir)
        yield* connection.tools()
      }),
    ).pipe(Effect.provide(recordingEnvironmentLayer(spawns))),
  )

  expect(spawns).toHaveLength(1)
  const command = spawns[0]
  if (!command || !ChildProcess.isStandardCommand(command)) throw new Error("Expected a standard process command")
  expect(command.command).toBe(process.execPath)
  expect(command.options.cwd).toBe(cwd)
  expect(command.options.extendEnv).toBe(true)
  expect(command.options.env).toEqual({ MCP_LOCATION_TEST: "configured" })
})

test("rejects sends before the stdio transport is started", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* MCPStdio.make({
          server: "not-started",
          command: process.execPath,
          args: [path.join(import.meta.dir, "fixture/mcp-output-schema.ts")],
          cwd: import.meta.dir,
          environment: {},
        })
        yield* Effect.tryPromise({
          try: () => transport.send({ jsonrpc: "2.0", method: "notifications/initialized" }),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(
          Effect.flip,
          Effect.tap((error) => Effect.sync(() => expect(error.message).toBe("Not connected"))),
        )
      }).pipe(Effect.provide(hostEnvironmentLayer)),
    ),
  )
})

test("joins concurrent stdio transport closes", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* MCPStdio.make({
          server: "concurrent-close",
          command: "unused",
          args: [],
          cwd: import.meta.dir,
          environment: {},
        })
        const first = transport.close()
        expect(transport.close()).toBe(first)
        yield* Effect.promise(() => first)
      }).pipe(Effect.provide(hostEnvironmentLayer)),
    ),
  )
})

test("closes a stdio process that finishes spawning after close", async () => {
  const spawning = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const exited = Deferred.makeUnsafe<ExitCode>()
  const signals: Array<string> = []
  const driver = Environment.makeMemoryDriver()
  const environment = Layer.succeed(
    Environment.Service,
    Environment.Service.of({
      files: Environment.makeFiles(driver),
      spawner: ChildProcessSpawner.make(() =>
        Effect.gen(function* () {
          yield* Deferred.succeed(spawning, undefined)
          yield* Deferred.await(release)
          return makeHandle({
            pid: ProcessId(1),
            exitCode: Deferred.await(exited),
            isRunning: Deferred.isDone(exited).pipe(Effect.map((done) => !done)),
            kill: (options) =>
              Effect.gen(function* () {
                signals.push(options?.killSignal ?? "SIGTERM")
                yield* Deferred.succeed(exited, ExitCode(143))
              }),
            stdin: Sink.drain,
            stdout: Stream.never,
            stderr: Stream.empty,
            all: Stream.never,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          })
        }),
      ),
    }),
  )

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* MCPStdio.make({
          server: "close-during-spawn",
          command: "unused",
          args: [],
          cwd: import.meta.dir,
          environment: {},
        })
        const start = transport.start()
        yield* Deferred.await(spawning)
        const close = transport.close()
        yield* Deferred.succeed(release, undefined)
        yield* Effect.promise(() => Promise.all([start, close]))
      }).pipe(Effect.provide(environment)),
    ),
  )

  expect(signals).toEqual(["SIGTERM"])
})

test("applies the configured MCP catalog timeout", async () => {
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* connect(
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
        const connection = yield* connect(
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
        const connection = yield* connect(
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
        const connection = yield* connect(
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
        const connection = yield* connect(
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

test("lists, reads, and reports MCP resource changes", async () => {
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
        const connection = yield* connect(
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

test("does not reconnect an SSE stream after a JSON-RPC error response", async () => {
  let requests = 0
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.invalid"), {
    fetch: async () => {
      requests += 1
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("id: prime\nretry: 1\ndata:\n\n"))
            controller.enqueue(
              new TextEncoder().encode(
                'id: error\ndata: {"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":1}\n\n',
              ),
            )
            controller.close()
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )
    },
    reconnectionOptions: {
      initialReconnectionDelay: 1,
      maxReconnectionDelay: 1,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 2,
    },
  })

  await transport.start()
  await transport.send({ jsonrpc: "2.0", method: "resources/list", id: 1 })
  await Bun.sleep(25)
  await transport.close()

  expect(requests).toBe(1)
})

test("skips MCP resource requests when the capability is absent", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ resources: false })
        const connection = yield* connect(
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

test("accepts empty MCP elicitations without creating forms", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ resources: false, emptyElicitation: true })
        const result = yield* Effect.gen(function* () {
          const service = yield* MCP.Service
          const forms = yield* Form.Service
          const result = yield* service.callTool({ server: "resources", name: "empty-elicitation" })
          expect(yield* forms.list()).toEqual([])
          return result
        }).pipe(Effect.provide(resourceMcpLayer(server.url)))

        expect(result.structured).toEqual({ action: "accept", content: {} })
      }),
    ),
  )
})

test("acknowledges completed MCP URL elicitations without returning internal content", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer({ resources: false, urlElicitation: true })
        const created = yield* Deferred.make<Form.Info>()
        const result = yield* Effect.gen(function* () {
          const service = yield* MCP.Service
          const forms = yield* Form.Service
          const call = yield* service.callTool({ server: "resources", name: "url-elicitation" }).pipe(Effect.forkScoped)

          const form = yield* Deferred.await(created)
          expect(form.fields).toEqual([{ key: "elicitation", type: "external", url: "https://example.com/authorize" }])

          yield* Effect.promise(server.completeElicitation)
          const result = yield* Fiber.join(call)
          expect(yield* forms.state(form.id)).toEqual({ status: "answered", answer: { elicitation: true } })
          return result
        }).pipe(
          Effect.provide(resourceMcpLayer(server.url, (form) => Deferred.succeed(created, form).pipe(Effect.asVoid))),
        )

        expect(result.structured).toEqual({ action: "accept" })
      }),
    ),
  )
})

test("loads and reads MCP resources", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer()
        server.state.resources = [{ name: "Readme", uri: "docs://readme" }]
        server.state.templates = [{ name: "File", uriTemplate: "docs://{path}" }]

        yield* Effect.gen(function* () {
          const service = yield* MCP.Service
          expect(yield* service.resourceCatalog()).toEqual({
            resources: [
              {
                server: "resources",
                name: "Readme",
                uri: "docs://readme",
                description: undefined,
                mimeType: undefined,
              },
            ],
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

          server.state.resources = [{ name: "Guide", uri: "docs://guide" }]
          expect((yield* service.resourceCatalog()).resources.map((resource) => resource.uri)).toEqual(["docs://guide"])
          expect(yield* service.readResource({ server: "resources", uri: "docs://readme" })).toEqual({
            server: "resources",
            uri: "docs://readme",
            contents: [
              { type: "text", uri: "docs://readme", text: "hello", mimeType: "text/plain" },
              { type: "blob", uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" },
            ],
          })
          expect(server.clientVersion()).toMatchObject({ name: "sdk", version: "1.2.3" })
        }).pipe(
          Effect.provide(resourceMcpLayer(server.url, undefined, { clientInfo: { name: "sdk", version: "1.2.3" } })),
        )
      }),
    ),
  )
})

test("adds, disconnects, and reconnects MCP servers at runtime", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const service = yield* MCP.Service

          expect((yield* service.servers())[0]?.status).toEqual({ status: "disabled" })
          expect(yield* service.connect("missing").pipe(Effect.flip)).toBeInstanceOf(MCP.NotFoundError)
          expect(yield* service.disconnect("missing").pipe(Effect.flip)).toBeInstanceOf(MCP.NotFoundError)
          yield* service.add(
            "dynamic",
            new ConfigMCP.Local({
              type: "local",
              command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-output-schema.ts")],
            }),
          )
          expect((yield* service.servers()).find((server) => server.name === "dynamic")?.status).toEqual({
            status: "connected",
          })

          yield* service.add(
            "dynamic",
            new ConfigMCP.Local({
              type: "local",
              command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-output-schema.ts")],
              disabled: true,
            }),
          )
          expect((yield* service.servers()).find((server) => server.name === "dynamic")?.status).toEqual({
            status: "disabled",
          })
          expect(yield* service.tools()).toEqual([])

          yield* service.connect("dynamic")
          expect((yield* service.servers()).find((server) => server.name === "dynamic")?.status).toEqual({
            status: "connected",
          })
          yield* service.disconnect("dynamic")
          expect((yield* service.servers()).find((server) => server.name === "dynamic")?.status).toEqual({
            status: "disabled",
          })
          expect(yield* service.tools()).toEqual([])

          yield* service.connect("dynamic")
          expect((yield* service.servers()).find((server) => server.name === "dynamic")?.status).toEqual({
            status: "connected",
          })

          yield* service.remove("dynamic")
          expect((yield* service.servers()).some((server) => server.name === "dynamic")).toBe(false)
          expect(yield* service.tools()).toEqual([])
          expect(yield* service.remove("dynamic").pipe(Effect.flip)).toBeInstanceOf(MCP.NotFoundError)
        }).pipe(
          Effect.provide(
            resourceMcpLayer(
              new ConfigMCP.Local({
                type: "local",
                command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-output-schema.ts")],
                disabled: true,
              }),
            ),
          ),
        )
      }),
    ),
  )
})

test("reconciles only changed MCP server config", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* resourceServer()
        const updates = yield* PubSub.unbounded<Payload>()
        const resources = (codemode?: boolean) =>
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false, codemode })
        const added = new ConfigMCP.Local({ type: "local", command: ["unused"], disabled: true })
        const dynamic = new ConfigMCP.Local({ type: "local", command: ["unused"], disabled: true })
        const document = (servers: Record<string, typeof ConfigMCP.Server.Type>, username?: string) =>
          new Document({
            type: "document",
            info: new Info({
              username,
              mcp: new ConfigMCP.Info({ servers }),
            }),
          })
        let entries = [document({ resources: resources() })]
        const publishUpdate = () =>
          PubSub.publish(updates, {
            id: ID.create(),
            created: DateTime.makeUnsafe(0),
            type: Event.Updated.type,
            data: {},
          } satisfies Payload<typeof Event.Updated>)

        yield* Effect.gen(function* () {
          const service = yield* MCP.Service
          yield* service.tools()
          expect(server.state.toolLists).toBe(1)
          expect(server.state.initializations).toBe(1)

          yield* service.add("dynamic", dynamic)
          entries = [document({ resources: resources() }, "unrelated")]
          yield* publishUpdate()
          entries = [document({ resources: resources(), added }, "unrelated")]
          yield* publishUpdate()
          const appended = yield* service.servers().pipe(
            Effect.filterOrFail(
              (items) => items.some((item) => item.name === "added"),
              () => new Error("MCP config addition was not applied"),
            ),
            Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }),
          )
          expect(appended.map((item) => String(item.name)).toSorted()).toEqual(["added", "dynamic", "resources"])
          expect(server.state.toolLists).toBe(1)
          expect(server.state.initializations).toBe(1)

          entries = [
            document(
              {
                resources: resources(false),
                added,
              },
              "unrelated",
            ),
          ]
          yield* publishUpdate()
          yield* Effect.sync(() => server.state.initializations).pipe(
            Effect.filterOrFail(
              (count) => count === 2,
              () => new Error("MCP config change did not reconnect the server"),
            ),
            Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }),
          )

          entries = [document({ added }, "unrelated")]
          yield* publishUpdate()
          const removed = yield* service.servers().pipe(
            Effect.filterOrFail(
              (items) => !items.some((item) => item.name === "resources"),
              () => new Error("MCP config removal was not applied"),
            ),
            Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }),
          )
          expect(removed.map((item) => String(item.name)).toSorted()).toEqual(["added", "dynamic"])
        }).pipe(
          Effect.provide(
            resourceMcpLayer(resources(), undefined, undefined, {
              entries: () => Effect.sync(() => entries),
              subscribe: (() => Stream.fromPubSub(updates)) as Bus.Interface["subscribe"],
            }),
          ),
        )
      }),
    ),
  )
})

test("reconciles MCP config changed during startup", async () => {
  const server = new ConfigMCP.Local({ type: "local", command: ["unused"], disabled: true })
  let reads = 0
  const entries = () =>
    Effect.sync(() => {
      reads += 1
      return [
        new Document({
          type: "document",
          info: new Info({
            mcp: new ConfigMCP.Info({
              servers: reads === 1 ? { initial: server } : { initial: server, added: server },
            }),
          }),
        }),
      ]
    })

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* MCP.Service
        expect((yield* service.servers()).map((item) => String(item.name))).toEqual(["added", "initial"])
        expect(reads).toBeGreaterThanOrEqual(2)
      }).pipe(Effect.provide(resourceMcpLayer(server, undefined, undefined, { entries }))),
    ),
  )
})

test("serializes concurrent MCP lifecycle operations", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const service = yield* MCP.Service

          // Whatever order the racing operations land in, the resulting state must be consistent.
          yield* Effect.all(
            [
              service.connect("resources"),
              service.connect("resources"),
              service.disconnect("resources"),
              service.connect("resources"),
            ],
            { concurrency: "unbounded", discard: true },
          )
          const status = (yield* service.servers()).find((server) => server.name === "resources")?.status
          const tools = yield* service.tools()
          expect(status?.status === "connected" || status?.status === "disabled").toBe(true)
          if (status?.status === "disabled") expect(tools).toEqual([])
          if (status?.status === "connected") expect(tools.length).toBeGreaterThan(0)

          yield* service.disconnect("resources")
          expect((yield* service.servers())[0]?.status).toEqual({ status: "disabled" })
          expect(yield* service.tools()).toEqual([])
          yield* service.connect("resources")
          expect((yield* service.servers())[0]?.status).toEqual({ status: "connected" })
          expect((yield* service.tools()).length).toBeGreaterThan(0)
        }).pipe(
          Effect.provide(
            resourceMcpLayer(
              new ConfigMCP.Local({
                type: "local",
                command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-output-schema.ts")],
                disabled: true,
              }),
            ),
          ),
        )
      }),
    ),
  )
})

it.effect("advertises MCP output schemas to Code Mode", () =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    const toolSet = yield* waitForCodeModeTool(registry, "demo.search")
    const execute = toolSet.definitions.find((tool) => tool.name === "execute")

    expect(toolSet.definitions.map((tool) => tool.name)).toEqual([
      "direct_fail",
      "direct_lookup",
      "direct_media",
      "execute",
    ])
    expect(toolSet.codeModeCatalog?.find((tool) => tool.path === "demo.search")?.signature).toContain("ok: boolean")
    expect(execute?.description).not.toContain("tools.demo.search")
  }),
)

it.effect("returns content-only MCP results through Code Mode", () =>
  Effect.gen(function* () {
    assertion = yield* Deferred.make<Permission.AssertInput>()
    decision = Effect.void
    const registry = yield* Tool.Service
    const toolSet = yield* waitForCodeModeTool(registry, "demo.status")

    const execution = yield* toolSet.execute({
      sessionID: Session.ID.make("ses_mcp_content_only"),
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_mcp_content_only",
        name: "execute",
        input: { code: "return await tools.demo.status({})" },
      },
    })

    expect(execution).toMatchObject({
      output: { output: "hello", toolCalls: [{ tool: "demo.status", status: "completed" }] },
      content: [{ type: "text", text: "hello" }],
    })
  }),
)

it.effect("advertises MCP tools directly when Code Mode is disabled for the server", () =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    yield* waitForTool(registry, "direct_lookup")
    const definitions = yield* toolDefinitions(registry)
    const execute = definitions.find((tool) => tool.name === "execute")

    expect(definitions.some((tool) => tool.name === "direct_lookup")).toBe(true)
    expect(execute?.description).not.toContain("tools.direct.lookup")
  }),
)

// Baseline (PLAN.md step 1): MCP isError must become one failed tool call, not a
// success whose text happens to describe an error.
it.effect("fails the call when MCP reports isError", () =>
  Effect.gen(function* () {
    assertion = yield* Deferred.make<Permission.AssertInput>()
    decision = Effect.void
    const registry = yield* Tool.Service
    yield* waitForTool(registry, "direct_fail")

    const execution = yield* executeTool(registry, {
      sessionID: Session.ID.make("ses_mcp_is_error"),
      ...toolIdentity,
      call: { type: "tool-call", id: "call_mcp_is_error", name: "direct_fail", input: {} },
    })

    expect(execution).toMatchObject({ status: "error", error: { message: "search index unavailable" } })
  }),
)

// Baseline (PLAN.md step 1): mixed MCP text and media content must reach the model intact.
it.effect("preserves MCP text and media content for the model", () =>
  Effect.gen(function* () {
    assertion = yield* Deferred.make<Permission.AssertInput>()
    decision = Effect.void
    const registry = yield* Tool.Service
    yield* waitForTool(registry, "direct_media")

    const execution = yield* executeTool(registry, {
      sessionID: Session.ID.make("ses_mcp_media"),
      ...toolIdentity,
      call: { type: "tool-call", id: "call_mcp_media", name: "direct_media", input: {} },
    })

    expect(execution.output).toBe("rendered chart")
    expect(execution.content).toMatchObject([
      { type: "text", text: "rendered chart" },
      { type: "file", mime: "image/png" },
    ])
  }),
)

it.effect("waits for permission before calling an MCP tool", () =>
  Effect.gen(function* () {
    calls = 0
    assertion = yield* Deferred.make<Permission.AssertInput>()
    const permission = yield* Deferred.make<void>()
    decision = Deferred.await(permission)
    const registry = yield* Tool.Service
    const toolSet = yield* waitForCodeModeTool(registry, "demo.search")

    const fiber = yield* toolSet
      .execute({
        sessionID: Session.ID.make("ses_mcp_permission"),
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_mcp_permission",
          name: "execute",
          input: { code: "return await tools.demo.search({})" },
        },
      })
      .pipe(Effect.forkScoped)
    expect(yield* Deferred.await(assertion)).toEqual({
      action: "demo_search",
      resources: ["*"],
      save: ["*"],
      metadata: {},
      sessionID: Session.ID.make("ses_mcp_permission"),
      agent: toolIdentity.agent,
      source: {
        type: "tool",
        messageID: toolIdentity.messageID,
        id: "call_mcp_permission",
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
    assertion = yield* Deferred.make<Permission.AssertInput>()
    decision = Effect.fail(new Permission.BlockedError({ rules: [], permission: "demo_search", resources: ["*"] }))
    const registry = yield* Tool.Service
    const toolSet = yield* waitForCodeModeTool(registry, "demo.search")

    const execution = yield* toolSet.execute({
      sessionID: Session.ID.make("ses_mcp_blocked"),
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_mcp_blocked",
        name: "execute",
        input: { code: "return await tools.demo.search({})" },
      },
    })
    expect(execution.content).toEqual([{ type: "text", text: "Unable to execute demo_search" }])
    expect(execution.metadata).toEqual({
      toolCalls: [{ tool: "demo.search", status: "error" }],
      error: true,
    })
    expect(calls).toBe(0)
  }),
)
