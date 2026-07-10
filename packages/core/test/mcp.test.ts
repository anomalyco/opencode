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
import { Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
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
      protocol.setRequestHandler(ListToolsRequestSchema, () =>
        Promise.resolve({
          tools: input.emptyElicitation
            ? [{ name: "empty-elicitation", inputSchema: { type: "object" as const, properties: {} } }]
            : input.urlElicitation
              ? [{ name: "url-elicitation", inputSchema: { type: "object" as const, properties: {} } }]
              : [],
        }),
      )
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
        fetch: (request) => transport.handleRequest(request),
      })
      return {
        state,
        url: http.url.toString(),
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

function resourceMcpLayer(url: string, onFormCreated?: (form: Form.Info) => Effect.Effect<void>) {
  const directory = AbsolutePath.make(import.meta.dir)
  const unusedIntegration = () => Effect.die("unused integration service")
  return MCP.layer.pipe(
    Layer.provideMerge(Form.layer),
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
          publish: (definition, data) => {
            const event = {
              id: EventV2.ID.create(),
              type: definition.type,
              data,
            } as EventV2.Payload<typeof definition>
            if (event.type !== Form.Event.Created.type || !onFormCreated) return Effect.succeed(event)
            return onFormCreated(Schema.decodeUnknownSync(Form.Event.Created.data)(data).form).pipe(Effect.as(event))
          },
        }),
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
        }).pipe(Effect.provide(resourceMcpLayer(server.url)))
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
