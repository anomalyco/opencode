import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { WebSearch } from "@opencode-ai/core/websearch"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { WebSearchTool } from "@opencode-ai/core/tool/websearch"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Image } from "@opencode-ai/core/image"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

const webSearchToolNode = makeLocationNode({
  name: "test/websearch-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(WebSearchTool.Plugin)),
  deps: [ToolRegistry.toolsNode, PermissionV2.node, WebSearch.node],
})

const sessionID = SessionV2.ID.make("ses_websearch_test")
const assertions: PermissionV2.AssertInput[] = []
const queries: WebSearch.QueryInput[] = []
let result = new WebSearch.Result({ providerID: WebSearch.ID.make("exa"), text: "search results" })

beforeEach(() => {
  assertions.length = 0
  queries.length = 0
  result = new WebSearch.Result({ providerID: WebSearch.ID.make("exa"), text: "search results" })
})

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
const websearch = Layer.succeed(
  WebSearch.Service,
  WebSearch.Service.of({
    register: () => Effect.die("unused"),
    list: () => Effect.succeed([]),
    selected: () => Effect.succeed(undefined),
    select: () => Effect.die("unused"),
    query: (input) =>
      Effect.sync(() => {
        queries.push(input)
        return result
      }),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, WebSearch.node, webSearchToolNode]),
    [
      [PermissionV2.node, permission],
      [WebSearch.node, websearch],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      [Image.node, imagePassthrough],
    ],
  ),
)

describe("WebSearchTool registration", () => {
  it.effect("asserts permission before delegating to WebSearch", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["websearch", "execute"])
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-search",
            name: "websearch",
            input: { query: "effect typescript" },
          },
        }),
      ).toMatchObject({
        status: "completed",
        content: [{ type: "text", text: "search results" }],
      })
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: "websearch",
          resources: ["effect typescript"],
          save: ["*"],
          metadata: { query: "effect typescript" },
        },
      ])
      expect(queries).toEqual([
        {
          sessionID,
          query: "effect typescript",
        },
      ])
    }),
  )

  it.effect("keeps provider metadata in structured output", () =>
    Effect.gen(function* () {
      result = new WebSearch.Result({
        providerID: WebSearch.ID.make("parallel"),
        text: "parallel results",
        metadata: { requestID: "req_1" },
      })
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-parallel", name: "websearch", input: { query: "effect layers" } },
        }),
      ).toEqual({
        status: "completed",
        output: { provider: "parallel", text: "parallel results", metadata: { requestID: "req_1" } },
        content: [{ type: "text", text: "parallel results" }],
        metadata: { provider: "parallel" },
      })
    }),
  )

  it.effect("uses the concise no-results fallback", () =>
    Effect.gen(function* () {
      result = new WebSearch.Result({ providerID: WebSearch.ID.make("exa"), text: "" })
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-empty", name: "websearch", input: { query: "nothing" } },
        }),
      ).toMatchObject({
        status: "completed",
        content: [{ type: "text", text: WebSearchTool.NO_RESULTS }],
      })
    }),
  )
})
