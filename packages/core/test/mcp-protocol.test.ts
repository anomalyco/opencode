import { expect } from "bun:test"
import { isJSONRPCRequest, type JSONRPCRequest } from "@modelcontextprotocol/client"
import { JSONRPCMessageSchema } from "@modelcontextprotocol/core"
import { createMcpHandler, Server } from "@modelcontextprotocol/server"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import { Session } from "@opencode-ai/schema/session"
import { McpClient } from "@opencode-ai/core/mcp/client"
import { Effect, Fiber } from "effect"
import { testEffect } from "./lib/effect"
import { hostEnvironmentLayer } from "./fixture/environment"

const it = testEffect(hostEnvironmentLayer)
const version = "2026-07-28"
const schema = { type: "object" as const, properties: { value: { type: "string" } }, required: ["value"] }
const tool = {
  name: "echo",
  inputSchema: { type: "object" as const, properties: { value: { type: "string", "x-mcp-header": "Value" } } },
  outputSchema: schema,
}

function serve(respond: (message: JSONRPCRequest, request: Request) => Response | Promise<Response>) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const requests: Array<{ method: string; message?: JSONRPCRequest; headers: Headers }> = []
      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        async fetch(request) {
          if (request.method !== "POST") {
            requests.push({ method: request.method, headers: request.headers })
            return new Response(null, { status: 405 })
          }
          const message = JSONRPCMessageSchema.parse(await request.clone().json())
          requests.push({
            method: "method" in message ? message.method : "response",
            headers: request.headers,
            ...(isJSONRPCRequest(message) ? { message } : {}),
          })
          if (!isJSONRPCRequest(message)) return new Response(null, { status: 202 })
          return respond(message, request)
        },
      })
      return {
        http,
        requests,
        config: new ConfigMCP.Remote({
          type: "remote",
          url: http.url.toString(),
          oauth: false,
          codemode: false,
          timeout: { startup: 1_000 },
        }),
      }
    }),
    ({ http }) => Effect.promise(() => http.stop(true)),
  )
}

function result(message: JSONRPCRequest, value: Record<string, unknown>, modern = true) {
  return Response.json({
    jsonrpc: "2.0",
    id: message.id,
    result: { ...(modern ? { resultType: "complete", ttlMs: 0, cacheScope: "private" } : {}), ...value },
  })
}

function discover(message: JSONRPCRequest) {
  return result(message, {
    supportedVersions: [version],
    capabilities: { tools: { listChanged: true }, prompts: { listChanged: true }, resources: { listChanged: true } },
    instructions: "  modern instructions  ",
    ttlMs: 0,
    cacheScope: "private",
  })
}

for (const status of [200, 400]) {
  for (const body of [
    "not json",
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse Error" } }),
  ]) {
    it.live(`falls back on completed non-modern discovery: ${status} ${body}`, () =>
      Effect.gen(function* () {
        const server = yield* serve((message) => {
          if (message.method === "server/discover")
            return new Response(body, { status, headers: { "content-type": "application/json" } })
          if (message.method === "initialize")
            return result(
              message,
              {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: { name: "legacy", version: "1" },
              },
              false,
            )
          return result(message, { tools: [tool] }, false)
        })
        const connection = yield* McpClient.connect("legacy", server.config, import.meta.dir)
        expect((yield* connection.tools()).map((tool) => tool.name)).toEqual(["echo"])
        expect(server.requests.filter((entry) => entry.method !== "GET").map((entry) => entry.method)).toEqual([
          "server/discover",
          "initialize",
          "notifications/initialized",
          "tools/list",
        ])
        expect(server.requests.find((entry) => entry.method === "initialize")?.headers.has("mcp-method")).toBe(false)
      }),
    )
  }
}

for (const status of [401, 403, 500]) {
  it.live(`does not downgrade HTTP ${status} to legacy`, () =>
    Effect.gen(function* () {
      const server = yield* serve(() => new Response(null, { status }))
      yield* McpClient.connect("failure", server.config, import.meta.dir).pipe(Effect.flip)
      expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover"])
    }),
  )
}

for (const code of [-32020, -32021, -32022]) {
  it.live(`does not downgrade a recognized modern error ${code}`, () =>
    Effect.gen(function* () {
      const server = yield* serve((message) =>
        Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            error: { code, message: "Modern refusal", data: { supported: ["2099-01-01"], requested: version } },
          },
          { status: 400 },
        ),
      )
      yield* McpClient.connect("failure", server.config, import.meta.dir).pipe(Effect.flip)
      expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover"])
    }),
  )
}

it.live("negotiates a supported modern version after a corrective response", () =>
  Effect.gen(function* () {
    let probes = 0
    const server = yield* serve((message) => {
      probes++
      if (probes === 1)
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32022,
              message: "Use supported version",
              data: { supported: [version], requested: version },
            },
          },
          { status: 400 },
        )
      return result(message, { supportedVersions: [version], capabilities: {} })
    })
    yield* McpClient.connect("modern", server.config, import.meta.dir)
    expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover", "server/discover"])
  }),
)

it.live("does not initialize a modern-only server with no mutually supported version", () =>
  Effect.gen(function* () {
    const server = yield* serve((message) => result(message, { supportedVersions: ["2099-01-01"], capabilities: {} }))
    yield* McpClient.connect("future", server.config, import.meta.dir).pipe(Effect.flip)
    expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover"])
  }),
)

it.live("modern HTTP executes MRTR, mirrors headers, validates outputs, and renews subscriptions without GET", () =>
  Effect.gen(function* () {
    const subscribed = Promise.withResolvers<void>()
    const renewed = Promise.withResolvers<void>()
    const changes = Promise.withResolvers<void>()
    const controllers: Array<ReadableStreamDefaultController<Uint8Array>> = []
    let listenID: string | number = ""
    let listens = 0
    let inputCalls = 0
    let notifications = 0
    const server = yield* serve((message) => {
      if (message.method === "server/discover") return discover(message)
      if (message.method === "subscriptions/listen") {
        listenID = message.id
        listens++
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controllers.push(controller)
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: { _meta: { "io.modelcontextprotocol/subscriptionId": message.id }, notifications: message.params?.notifications } })}\n\n`,
                ),
              )
              if (listens === 1) subscribed.resolve()
              if (listens === 2) renewed.resolve()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      }
      if (message.method === "tools/list") return result(message, { tools: [tool] })
      if (message.method === "prompts/list") return result(message, { prompts: [{ name: "hello" }] })
      if (message.method === "resources/list")
        return result(message, { resources: [{ name: "doc", uri: "docs://hello" }] })
      if (message.method === "resources/templates/list")
        return result(message, { resourceTemplates: [{ name: "doc", uriTemplate: "docs://{name}" }] })
      if (message.method === "prompts/get")
        return result(message, { messages: [{ role: "user", content: { type: "text", text: "hello" } }] })
      if (message.method === "resources/read")
        return result(message, { contents: [{ uri: "docs://hello", text: "hello" }] })
      if (message.method === "tools/call") {
        inputCalls++
        if (!message.params?.inputResponses)
          return Response.json({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              resultType: "input_required",
              inputRequests: {
                roots: { method: "roots/list" },
                form: {
                  method: "elicitation/create",
                  params: { mode: "form", message: "Confirm", requestedSchema: schema },
                },
                url: {
                  method: "elicitation/create",
                  params: { mode: "url", message: "Authorize", url: "https://example.com/auth" },
                },
              },
              requestState: "opaque-state",
            },
          })
        return result(message, {
          content: [{ type: "text", text: "complete" }],
          structuredContent: { value: message.params?.arguments && Reflect.get(message.params.arguments, "value") },
        })
      }
      return new Response(null, { status: 404 })
    })
    const inputs: McpClient.ElicitationParams[] = []
    const connection = yield* McpClient.connect(
      "modern",
      server.config,
      import.meta.dir,
      undefined,
      {
        create: ({ params }) =>
          Effect.sync(() => {
            inputs.push(params)
            return params.mode === "url"
              ? { action: "accept" as const }
              : { action: "accept" as const, content: { value: "yes" } }
          }),
        complete: () => Effect.void,
      },
      { name: "opencode-test", version: "1" },
    )
    connection.onToolsChanged(() => {
      notifications++
      changes.resolve()
    })
    expect(connection.instructions).toBe("modern instructions")
    expect(yield* connection.tools()).toHaveLength(1)
    expect(yield* connection.prompts()).toHaveLength(1)
    expect(yield* connection.resources()).toHaveLength(1)
    expect(yield* connection.resourceTemplates()).toHaveLength(1)
    expect((yield* connection.prompt({ name: "hello" })).messages).toHaveLength(1)
    expect((yield* connection.readResource({ uri: "docs://hello" }))?.contents).toHaveLength(1)
    expect(
      (yield* connection.callTool({
        name: "echo",
        args: { value: " padded " },
        sessionID: Session.ID.make("ses_mcp_modern"),
      })).structured,
    ).toEqual({
      value: " padded ",
    })
    expect(inputCalls).toBe(2)
    expect(inputs).toHaveLength(2)
    const urlInput = inputs.find((input) => input.mode === "url")
    expect(urlInput).toMatchObject({ mode: "url", url: "https://example.com/auth" })
    expect(urlInput).not.toHaveProperty("elicitationId")
    const calls = server.requests.filter((entry) => entry.method === "tools/call")
    expect(calls[1]?.message?.params).toMatchObject({
      requestState: "opaque-state",
      inputResponses: {
        roots: { roots: [{ uri: expect.stringContaining("file://") }] },
        form: { action: "accept", content: { value: "yes" } },
        url: { action: "accept" },
      },
    })
    for (const entry of calls) {
      expect(entry.message?.params?._meta).toMatchObject({
        sessionID: "ses_mcp_modern",
        "io.modelcontextprotocol/logLevel": "debug",
      })
      expect(entry.headers.get("mcp-name")).toBe("echo")
      expect(entry.headers.get("mcp-param-value")).toBe("=?base64?IHBhZGRlZCA=?=")
    }
    yield* connection.callTool({ name: "echo", args: { value: 123 } }).pipe(Effect.flip)
    expect(inputCalls).toBe(4)
    for (const entry of server.requests.filter((entry) => entry.method === "tools/call").slice(2)) {
      expect(entry.message?.params?._meta).not.toHaveProperty("sessionID")
    }
    yield* Effect.promise(() => subscribed.promise)
    controllers[0]?.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { _meta: { "io.modelcontextprotocol/subscriptionId": "not-our-subscription" } } })}\n\n`,
      ),
    )
    controllers[0]?.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { _meta: { "io.modelcontextprotocol/subscriptionId": listenID } } })}\n\n`,
      ),
    )
    yield* Effect.promise(() => changes.promise).pipe(Effect.timeout("2 seconds"))
    expect(notifications).toBe(1)
    controllers[0]?.enqueue(new TextEncoder().encode("id: legacy-resume-is-forbidden\n: keepalive\n\n"))
    controllers[0]?.close()
    yield* Effect.promise(() => renewed.promise).pipe(Effect.timeout("3 seconds"))
    expect(listens).toBe(2)
    expect(
      server.requests.some((entry) =>
        ["GET", "initialize", "notifications/initialized", "notifications/cancelled"].includes(entry.method),
      ),
    ).toBe(false)
    for (const entry of server.requests) {
      expect(entry.headers.get("mcp-protocol-version")).toBe(version)
      expect(entry.headers.get("mcp-method")).toBe(entry.method)
      expect(entry.headers.has("mcp-session-id")).toBe(false)
      expect(entry.message?.params?._meta).toMatchObject({
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientInfo": { name: "opencode-test" },
      })
    }
  }),
)

it.live("cancels HTTP discovery without falling back or leaving a request alive", () =>
  Effect.gen(function* () {
    const started = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const server = yield* serve((_message, request) => {
      started.resolve()
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
      return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } })
    })
    const fiber = yield* McpClient.connect("cancel", server.config, import.meta.dir).pipe(Effect.forkScoped)
    yield* Effect.promise(() => started.promise)
    yield* Fiber.interrupt(fiber)
    yield* Effect.promise(() => aborted.promise).pipe(Effect.timeout("1 second"))
    expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover"])
  }),
)

for (const legacy of ["reject", "stateless"] as const) {
  it.live(`connects to SDK HTTP hosting with legacy=${legacy}`, () =>
    Effect.gen(function* () {
      const handler = createMcpHandler(
        () => {
          const server = new Server(
            { name: "modern-sdk", version: "1" },
            { capabilities: { tools: {}, logging: {} }, instructions: "sdk instructions" },
          )
          server.setRequestHandler("tools/list", async () => ({ tools: [tool] }))
          server.setRequestHandler("tools/call", async (_request, ctx) => {
            await ctx.mcpReq.log("info", "modern log")
            return { content: [{ type: "text", text: "sdk" }], structuredContent: { value: "sdk" } }
          })
          return server
        },
        { legacy },
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => handler.close()))
      const server = yield* serve((_message, request) => handler.fetch(request))
      const connection = yield* McpClient.connect("sdk", server.config, import.meta.dir)
      const logs: McpClient.LogMessage[] = []
      connection.onLog((message) => logs.push(message))
      expect(connection.instructions).toBe("sdk instructions")
      expect(yield* connection.tools()).toHaveLength(1)
      expect((yield* connection.callTool({ name: "echo", args: { value: "sdk" } })).structured).toEqual({
        value: "sdk",
      })
      expect(logs).toMatchObject([{ level: "info", data: "modern log" }])
      expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover", "tools/list", "tools/call"])
    }),
  )
}

for (const format of ["json", "sse", "html", "empty"]) {
  it.live(`legacy fallback accepts completed ${format} discovery replies`, () =>
    Effect.gen(function* () {
      const server = yield* serve((message) => {
        if (message.method === "server/discover") {
          if (format === "empty") return new Response(null, { status: 202 })
          if (format === "html")
            return new Response("<html>Not found</html>", { headers: { "content-type": "text/html" } })
          const error = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse Error" } })
          return new Response(format === "sse" ? `data: ${error}\n\n` : error, {
            headers: { "content-type": format === "sse" ? "text/event-stream" : "application/json" },
          })
        }
        return result(
          message,
          { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "legacy", version: "1" } },
          false,
        )
      })
      yield* McpClient.connect("legacy", server.config, import.meta.dir)
      expect(server.requests.filter((entry) => entry.method === "initialize")).toHaveLength(1)
    }),
  )
}

it.live("modern catalogs preserve schema validation and HTTP header-declaration filtering", () =>
  Effect.gen(function* () {
    const server = yield* serve((message) => {
      if (message.method === "server/discover")
        return result(message, { supportedVersions: [version], capabilities: { tools: {} } })
      if (message.method === "tools/list")
        return result(
          message,
          message.params?.cursor
            ? { tools: [tool] }
            : {
                tools: [
                  { name: "plain", inputSchema: { type: "object" } },
                  {
                    name: "bad-header",
                    inputSchema: { type: "object", properties: { value: { type: "array", "x-mcp-header": "Bad" } } },
                  },
                ],
                nextCursor: "second",
              },
        )
      return result(message, { content: [], structuredContent: { value: 123 } })
    })
    const connection = yield* McpClient.connect("schemas", server.config, import.meta.dir)
    const tools = yield* connection.tools()
    expect(tools.map((tool) => tool.name)).toEqual(["plain", "echo"])
    expect(tools[0]?.outputSchema).toBeUndefined()
    expect(tools[1]?.outputSchema).toEqual(schema)
    expect((yield* connection.callTool({ name: "plain" })).structured).toEqual({ value: 123 })
    const error = yield* connection.callTool({ name: "echo" }).pipe(Effect.flip)
    expect(error.message).toContain("does not match")
    expect(server.requests.filter((entry) => entry.method === "tools/list")).toHaveLength(2)
    expect(server.requests.filter((entry) => entry.method === "tools/call")).toHaveLength(2)
  }),
)

it.live("modern HTTP execution timeout aborts the stream without cancellation POSTs or replay", () =>
  Effect.gen(function* () {
    const aborted = Promise.withResolvers<void>()
    const server = yield* serve((message, request) => {
      if (message.method === "server/discover")
        return result(message, { supportedVersions: [version], capabilities: { tools: {} } })
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
      return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } })
    })
    const connection = yield* McpClient.connect(
      "timeout",
      new ConfigMCP.Remote({ ...server.config, timeout: { execution: 50, startup: 1_000 } }),
      import.meta.dir,
    )
    const error = yield* connection.callTool({ name: "slow" }).pipe(Effect.flip)
    expect(error.message).toBe("Request timed out")
    yield* Effect.promise(() => aborted.promise).pipe(Effect.timeout("1 second"))
    expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover", "tools/call"])
  }),
)

it.live("modern HTTP 404 does not initialize or replay even with a configured session header", () =>
  Effect.gen(function* () {
    const server = yield* serve((message) =>
      message.method === "server/discover"
        ? result(message, { supportedVersions: [version], capabilities: { tools: {} } })
        : new Response("Missing method", { status: 404 }),
    )
    const connection = yield* McpClient.connect(
      "404",
      new ConfigMCP.Remote({ ...server.config, headers: { "mcp-session-id": "stale" } }),
      import.meta.dir,
    )
    yield* connection.callTool({ name: "missing" }).pipe(Effect.flip)
    expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover", "tools/call"])
    expect(server.requests.every((entry) => !entry.headers.has("mcp-session-id"))).toBe(true)
  }),
)

it.live("MRTR execution deadline interrupts pending elicitation and never sends its retry", () =>
  Effect.gen(function* () {
    const interrupted = Promise.withResolvers<void>()
    const server = yield* serve((message) =>
      message.method === "server/discover"
        ? result(message, { supportedVersions: [version], capabilities: { tools: {} } })
        : Response.json({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              resultType: "input_required",
              inputRequests: {
                question: {
                  method: "elicitation/create",
                  params: { mode: "form", message: "Wait", requestedSchema: schema },
                },
              },
              requestState: "state",
            },
          }),
    )
    const connection = yield* McpClient.connect(
      "elicitation-timeout",
      new ConfigMCP.Remote({ ...server.config, timeout: { execution: 50, startup: 1_000 } }),
      import.meta.dir,
      undefined,
      {
        create: () => Effect.never.pipe(Effect.ensuring(Effect.sync(() => interrupted.resolve()))),
        complete: () => Effect.void,
      },
    )
    const error = yield* connection.callTool({ name: "wait" }).pipe(Effect.flip)
    expect(error.message).toBe("Request timed out")
    yield* Effect.promise(() => interrupted.promise).pipe(Effect.timeout("1 second"))
    expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover", "tools/call"])
  }),
)

for (const acknowledge of [false, true]) {
  it.live(`scope closure cancels the HTTP subscription stream (acknowledged=${acknowledge})`, () =>
    Effect.gen(function* () {
      const listening = Promise.withResolvers<void>()
      const aborted = Promise.withResolvers<void>()
      const server = yield* serve((message, request) => {
        if (message.method === "server/discover") return discover(message)
        request.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              if (acknowledge)
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: { _meta: { "io.modelcontextprotocol/subscriptionId": message.id }, notifications: message.params?.notifications } })}\n\n`,
                  ),
                )
              listening.resolve()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* McpClient.connect("subscription-close", server.config, import.meta.dir)
          yield* Effect.promise(() => listening.promise)
        }),
      ).pipe(Effect.timeout("1 second"))
      yield* Effect.promise(() => aborted.promise).pipe(Effect.timeout("1 second"))
      expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover", "subscriptions/listen"])
    }),
  )
}

it.live("an interrupted modern response fails promptly without legacy SSE resumption", () =>
  Effect.gen(function* () {
    const server = yield* serve((message) =>
      message.method === "server/discover"
        ? result(message, { supportedVersions: [version], capabilities: { tools: {} } })
        : new Response("id: not-resumable\n: heartbeat\n\n", { headers: { "content-type": "text/event-stream" } }),
    )
    const connection = yield* McpClient.connect("interrupted", server.config, import.meta.dir)
    const error = yield* connection.callTool({ name: "interrupted" }).pipe(Effect.flip, Effect.timeout("1 second"))
    expect(error.message).toBe("MCP response stream ended before a result")
    expect(server.requests.map((entry) => entry.method)).toEqual(["server/discover", "tools/call"])
  }),
)
