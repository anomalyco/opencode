import { beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { WebSearchTool } from "@opencode-ai/core/tool/websearch"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_websearch_test")
const payload = (text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  })

describe("WebSearchTool provider selection", () => {
  test("rejects out-of-range numeric controls", () => {
    const decode = Schema.decodeUnknownSync(WebSearchTool.Input)
    expect(() => decode({ query: "x", numResults: 0 })).toThrow()
    expect(() => decode({ query: "x", numResults: WebSearchTool.MAX_NUM_RESULTS + 1 })).toThrow()
    expect(() => decode({ query: "x", contextMaxCharacters: WebSearchTool.MAX_CONTEXT_CHARACTERS + 1 })).toThrow()
  })
  test("selects a stable provider per session", () => {
    expect(WebSearchTool.selectProvider(sessionID)).toBe(WebSearchTool.selectProvider(sessionID))
  })

  test("supports an explicit operational override", () => {
    expect(
      WebSearchTool.selectProvider(
        sessionID,
        { enableExa: false, enableParallel: false, enableTinyfish: false },
        "parallel",
      ),
    ).toBe("parallel")
    expect(
      WebSearchTool.selectProvider(sessionID, { enableExa: false, enableParallel: false, enableTinyfish: false }, "exa"),
    ).toBe("exa")
    expect(
      WebSearchTool.selectProvider(
        sessionID,
        { enableExa: false, enableParallel: false, enableTinyfish: false },
        "tinyfish",
      ),
    ).toBe("tinyfish")
  })

  test("prefers Parallel when both explicit flags are enabled", () => {
    expect(
      WebSearchTool.selectProvider(sessionID, { enableExa: true, enableParallel: true, enableTinyfish: false }),
    ).toBe("parallel")
  })

  test("prefers Exa when only its explicit flag is enabled", () => {
    expect(
      WebSearchTool.selectProvider(sessionID, { enableExa: true, enableParallel: false, enableTinyfish: false }),
    ).toBe("exa")
  })

  test("selects TinyFish when only its explicit flag is enabled", () => {
    expect(
      WebSearchTool.selectProvider(sessionID, { enableExa: false, enableParallel: false, enableTinyfish: true }),
    ).toBe("tinyfish")
  })

  test("extracts Mcp-Session-Id case-insensitively", () => {
    expect(WebSearchTool.mcpSessionIdFromHeaders({ "mcp-session-id": "abc" })).toBe("abc")
    expect(WebSearchTool.mcpSessionIdFromHeaders({ "Mcp-Session-Id": "abc" } as Record<string, string>)).toBe("abc")
    expect(WebSearchTool.mcpSessionIdFromHeaders({ "MCP-SESSION-ID": "abc" } as Record<string, string>)).toBe("abc")
    expect(WebSearchTool.mcpSessionIdFromHeaders({})).toBeUndefined()
  })
})

describe("WebSearchTool MCP response parser", () => {
  test("parses plain JSON-RPC responses", async () => {
    expect(await Effect.runPromise(WebSearchTool.parseResponse(payload("search results")))).toBe("search results")
  })

  test("parses SSE JSON-RPC responses and ignores non-JSON frames", async () => {
    expect(
      await Effect.runPromise(
        WebSearchTool.parseResponse(`data: [DONE]\nevent: message\ndata: ${payload("search results")}\n\n`),
      ),
    ).toBe("search results")
  })
})

interface Request {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

const requests: Request[] = []
const assertions: PermissionV2.AssertInput[] = []
let responseBody = payload("search results")
let makeResponse = () => new Response(responseBody, { status: 200 })
let tinyfishSessionId: string | undefined = "test-session-123"
let config: WebSearchTool.Config = { enableExa: false, enableParallel: false, enableTinyfish: false }

beforeEach(() => {
  responseBody = payload("search results")
  makeResponse = () => new Response(responseBody, { status: 200 })
  tinyfishSessionId = "test-session-123"
})

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag !== "Uint8Array") throw new Error(`Unexpected request body: ${request.body._tag}`)
      const parsed = JSON.parse(new TextDecoder().decode(request.body.body))
      requests.push({
        url: request.url,
        headers: request.headers,
        body: parsed,
      })
      if (parsed?.method === "initialize") {
        const headers = tinyfishSessionId ? { "Mcp-Session-Id": tinyfishSessionId } : {}
        return HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 0,
              result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "tinyfish", version: "test" } },
            }),
            { status: 200, headers },
          ),
        )
      }
      return HttpClientResponse.fromWeb(request, makeResponse())
    }),
  ),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const websearchConfig = Layer.succeed(
  WebSearchTool.ConfigService,
  WebSearchTool.ConfigService.of({
    get provider() {
      return config.provider
    },
    get enableExa() {
      return config.enableExa
    },
    get enableParallel() {
      return config.enableParallel
    },
    get enableTinyfish() {
      return config.enableTinyfish
    },
    get exaApiKey() {
      return config.exaApiKey
    },
    get parallelApiKey() {
      return config.parallelApiKey
    },
    get tinyfishApiKey() {
      return config.tinyfishApiKey
    },
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, WebSearchTool.configNode, WebSearchTool.node]),
    [
      [PermissionV2.node, permission],
      [LayerNodePlatform.httpClient, http],
      [WebSearchTool.configNode, websearchConfig],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

describe("WebSearchTool registration", () => {
  it.effect("registers websearch, asserts query permission, and calls Exa", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("exa results")
      config = { provider: "exa", enableExa: false, enableParallel: false, enableTinyfish: false }
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["websearch"])
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-exa",
            name: "websearch",
            input: {
              query: "effect typescript",
              numResults: 3,
              livecrawl: "preferred",
              type: "fast",
              contextMaxCharacters: 2500,
            },
          },
        }),
      ).toEqual({ type: "text", value: "exa results" })
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: "websearch",
          resources: ["effect typescript"],
          save: ["*"],
          metadata: {
            query: "effect typescript",
            numResults: 3,
            livecrawl: "preferred",
            type: "fast",
            contextMaxCharacters: 2500,
            provider: "exa",
          },
        },
      ])
      expect(requests).toEqual([
        {
          url: WebSearchTool.EXA_URL,
          headers: expect.any(Object),
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "web_search_exa",
              arguments: {
                query: "effect typescript",
                type: "fast",
                numResults: 3,
                livecrawl: "preferred",
                contextMaxCharacters: 2500,
              },
            },
          },
        },
      ])
    }),
  )

  it.effect("calls Parallel with session ID and keeps bearer credentials out of output", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("parallel results")
      config = {
        provider: "parallel",
        enableExa: false,
        enableParallel: false,
        enableTinyfish: false,
        parallelApiKey: "parallel-secret",
      }
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-parallel", name: "websearch", input: { query: "effect layers" } },
      })

      expect(requests[0]).toMatchObject({
        url: WebSearchTool.PARALLEL_URL,
        headers: { authorization: "Bearer parallel-secret" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search",
            arguments: { objective: "effect layers", search_queries: ["effect layers"], session_id: sessionID },
          },
        },
      })
      expect(requests[0]?.body).not.toHaveProperty("params.arguments.model_name")
      expect(settled).toEqual({
        result: { type: "text", value: "parallel results" },
        output: {
          structured: { provider: "parallel", text: "parallel results" },
          content: [{ type: "text", text: "parallel results" }],
        },
      })
      expect(JSON.stringify(settled)).not.toContain("parallel-secret")
    }),
  )

  it.effect("keeps an Exa credential in the transport URL and out of model output", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("credentialed exa results")
      config = {
        provider: "exa",
        enableExa: false,
        enableParallel: false,
        enableTinyfish: false,
        exaApiKey: "exa secret",
      }
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-exa-key", name: "websearch", input: { query: "effect schema" } },
      })

      expect(requests[0]?.url).toBe(`${WebSearchTool.EXA_URL}?exaApiKey=exa+secret`)
      expect(JSON.stringify(settled)).not.toContain("exa secret")
    }),
  )

  it.effect("returns the legacy no-results fallback as concise model text", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = ""
      config = { provider: "exa", enableExa: false, enableParallel: false, enableTinyfish: false }
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-empty", name: "websearch", input: { query: "nothing" } },
        }),
      ).toEqual({ type: "text", value: WebSearchTool.NO_RESULTS })
    }),
  )

  it.effect("rejects oversized MCP response bodies", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      let chunksRead = 0
      let cancelled = false
      makeResponse = () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              chunksRead++
              if (chunksRead === 10) throw new Error("response was not stopped at the byte limit")
              controller.enqueue(new Uint8Array(64 * 1024))
            },
            cancel() {
              cancelled = true
            },
          }),
          { status: 200 },
        )
      config = { provider: "exa", enableExa: false, enableParallel: false, enableTinyfish: false }
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-large-response", name: "websearch", input: { query: "too much" } },
        }),
      ).toEqual({ type: "error", value: "Unable to search the web for too much" })
      expect(chunksRead).toBeLessThan(10)
      expect(cancelled).toBe(true)
    }),
  )

  it.effect("calls TinyFish with Mcp-Session-Id from initialize", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("tinyfish results")
      tinyfishSessionId = "session-abc-123"
      config = {
        provider: "tinyfish",
        enableExa: false,
        enableParallel: false,
        enableTinyfish: true,
        tinyfishApiKey: "tinyfish-secret",
      }
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-tinyfish", name: "websearch", input: { query: "effect layers" } },
      })

      expect(requests.length).toBe(2)
      expect(requests[0]).toMatchObject({
        url: WebSearchTool.TINYFISH_URL,
        body: { jsonrpc: "2.0", method: "initialize" },
      })
      expect(requests[0]?.headers).not.toHaveProperty("mcp-session-id")
      expect(requests[1]).toMatchObject({
        url: WebSearchTool.TINYFISH_URL,
        headers: { authorization: "Bearer tinyfish-secret", "mcp-session-id": "session-abc-123" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search", arguments: { query: "effect layers" } },
        },
      })
      expect(settled).toEqual({
        result: { type: "text", value: "tinyfish results" },
        output: {
          structured: { provider: "tinyfish", text: "tinyfish results" },
          content: [{ type: "text", text: "tinyfish results" }],
        },
      })
      expect(JSON.stringify(settled)).not.toContain("tinyfish-secret")
    }),
  )

  it.effect("fails TinyFish search when initialize omits Mcp-Session-Id", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("should not be used")
      tinyfishSessionId = undefined
      config = { provider: "tinyfish", enableExa: false, enableParallel: false, enableTinyfish: true }
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-tinyfish-missing-session", name: "websearch", input: { query: "x" } },
        }),
      ).toEqual({ type: "error", value: "Unable to search the web for x" })
      expect(requests.length).toBe(1)
      expect(requests[0]?.body).toMatchObject({ method: "initialize" })
    }),
  )
})
