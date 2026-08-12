import { beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { MiniMaxImageGenerationTool } from "@opencode-ai/core/tool/minimax-image-generation"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_minimax_image_test")
const requests: Array<{ readonly url: string; readonly headers: Record<string, string>; readonly body: unknown }> = []
const assertions: PermissionV2.AssertInput[] = []
let config: MiniMaxImageGenerationTool.Config = { apiKey: "minimax-secret", region: "global_en" }
let responseBody: unknown = {}

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag !== "Uint8Array") throw new Error(`Unexpected request body: ${request.body._tag}`)
      requests.push({
        url: request.url,
        headers: request.headers,
        body: JSON.parse(new TextDecoder().decode(request.body.body)),
      })
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } }),
      )
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
const toolConfig = Layer.succeed(
  MiniMaxImageGenerationTool.ConfigService,
  MiniMaxImageGenerationTool.ConfigService.of({
    get apiKey() {
      return config.apiKey
    },
    get region() {
      return config.region
    },
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      MiniMaxImageGenerationTool.configNode,
      MiniMaxImageGenerationTool.node,
    ]),
    [
      [PermissionV2.node, permission],
      [LayerNodePlatform.httpClient, http],
      [MiniMaxImageGenerationTool.configNode, toolConfig],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const call = (input: typeof MiniMaxImageGenerationTool.Input.Type, id = "call-minimax-image") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: MiniMaxImageGenerationTool.name, input },
})

beforeEach(() => {
  requests.length = 0
  assertions.length = 0
  config = { apiKey: "minimax-secret", region: "global_en" }
  responseBody = {
    data: { image_urls: ["https://example.com/generated.png"] },
    metadata: { success_count: 1, failed_count: 0 },
    base_resp: { status_code: 0, status_msg: "success" },
  }
})

describe("MiniMaxImageGenerationTool input", () => {
  test("accepts the target models and rejects invalid counts", () => {
    const decode = Schema.decodeUnknownSync(MiniMaxImageGenerationTool.Input)
    expect(decode({ model: "image-01", prompt: "A lighthouse", n: 9 })).toMatchObject({ model: "image-01", n: 9 })
    expect(decode({ model: "image-01-live", prompt: "A lighthouse" })).toMatchObject({ model: "image-01-live" })
    expect(() => decode({ prompt: "A lighthouse", n: 10 })).toThrow()
  })

  test("selects the exact regional endpoints", () => {
    expect(MiniMaxImageGenerationTool.endpoint("global_en")).toBe(MiniMaxImageGenerationTool.GLOBAL_ENDPOINT)
    expect(MiniMaxImageGenerationTool.endpoint("cn_zh")).toBe(MiniMaxImageGenerationTool.CN_ENDPOINT)
  })
})

describe("MiniMaxImageGenerationTool registration", () => {
  it.effect("generates URL output through the global endpoint", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([MiniMaxImageGenerationTool.name])

      expect(
        yield* executeTool(
          registry,
          call({
            model: "image-01-live",
            prompt: "A lighthouse in watercolor",
            aspectRatio: "16:9",
            responseFormat: "url",
            seed: 42,
            n: 1,
            promptOptimizer: true,
          }),
        ),
      ).toEqual({ type: "text", value: "https://example.com/generated.png" })
      expect(requests).toMatchObject([
        {
          url: MiniMaxImageGenerationTool.GLOBAL_ENDPOINT,
          headers: { authorization: "Bearer minimax-secret" },
          body: {
            model: "image-01-live",
            prompt: "A lighthouse in watercolor",
            aspect_ratio: "16:9",
            response_format: "url",
            seed: 42,
            n: 1,
            prompt_optimizer: true,
          },
        },
      ])
      expect(assertions).toMatchObject([
        {
          action: MiniMaxImageGenerationTool.name,
          resources: ["A lighthouse in watercolor"],
          metadata: { model: "image-01-live", responseFormat: "url", region: "global_en" },
        },
      ])
      expect(
        JSON.stringify(yield* settleTool(registry, call({ prompt: "A second lighthouse" }, "call-second"))),
      ).not.toContain("minimax-secret")
    }),
  )

  it.effect("returns base64 images as file content through the China endpoint", () =>
    Effect.gen(function* () {
      config = { apiKey: "minimax-secret", region: "cn_zh" }
      responseBody = {
        data: { image_base64: ["iVBORw0KGgo="] },
        metadata: { success_count: "1", failed_count: "0" },
        base_resp: { status_code: 0, status_msg: "success" },
      }
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(
        registry,
        call({ prompt: "A mountain at dawn", width: 1024, height: 1024, responseFormat: "base64" }),
      )
      expect(requests[0]).toMatchObject({
        url: MiniMaxImageGenerationTool.CN_ENDPOINT,
        body: { model: "image-01", width: 1024, height: 1024, response_format: "base64" },
      })
      expect(settled).toMatchObject({
        result: {
          type: "content",
          value: [{ type: "file", mime: "image/png", name: "minimax-image-1.png" }],
        },
        output: {
          structured: { successCount: 1, failedCount: 0 },
          content: [{ type: "file", mime: "image/png", name: "minimax-image-1.png" }],
        },
      })
    }),
  )

  it.effect("rejects invalid dimensions before permission or transport", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect(yield* executeTool(registry, call({ prompt: "A mountain", width: 1024 }))).toEqual({
        type: "error",
        value: "Unable to generate images",
      })
      expect(requests).toEqual([])
      expect(assertions).toEqual([])
    }),
  )

  it.effect("fails without a credential before permission or transport", () =>
    Effect.gen(function* () {
      config = { region: "global_en" }
      const registry = yield* ToolRegistry.Service
      expect(yield* executeTool(registry, call({ prompt: "A mountain" }))).toEqual({
        type: "error",
        value: "Unable to generate images",
      })
      expect(requests).toEqual([])
      expect(assertions).toEqual([])
    }),
  )

  it.effect("rejects unsuccessful API payloads", () =>
    Effect.gen(function* () {
      responseBody = {
        data: {},
        base_resp: { status_code: 1002, status_msg: "rate limited" },
      }
      const registry = yield* ToolRegistry.Service
      expect(yield* executeTool(registry, call({ prompt: "A mountain" }))).toEqual({
        type: "error",
        value: "Unable to generate images",
      })
    }),
  )
})
