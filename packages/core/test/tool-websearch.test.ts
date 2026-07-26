import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Form } from "@opencode-ai/core/form"
import { KV } from "@opencode-ai/core/kv"
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
import { webSearchHost } from "./plugin/host"

const webSearchToolNode = makeLocationNode({
  name: "test/websearch-tool-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      yield* registerToolPlugin(WebSearchTool.Plugin, { websearch: webSearchHost(websearch) })
    }),
  ),
  deps: [ToolRegistry.toolsNode, PermissionV2.node, WebSearch.node, Form.node, KV.node],
})

const sessionID = SessionV2.ID.make("ses_websearch_test")
const assertions: PermissionV2.AssertInput[] = []
const queries: WebSearch.Input[] = []
let result = new WebSearch.Response({
  providerID: WebSearch.ID.make("exa"),
  results: [{ url: "https://example.com", title: "Search results", content: "search results", time: {} }],
})

beforeEach(() => {
  assertions.length = 0
  queries.length = 0
  result = new WebSearch.Response({
    providerID: WebSearch.ID.make("exa"),
    results: [{ url: "https://example.com", title: "Search results", content: "search results", time: {} }],
  })
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
    transform: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
    providers: () => Effect.succeed([]),
    default: () => Effect.succeed(undefined),
    query: (input) =>
      Effect.sync(() => {
        queries.push(input)
        return result
      }),
  }),
)
const form = Layer.succeed(
  Form.Service,
  Form.Service.of({
    create: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    state: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  }),
)
const kv = Layer.succeed(
  KV.Service,
  KV.Service.of({
    get: () => Effect.succeed(undefined),
    set: () => Effect.void,
    remove: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, WebSearch.node, webSearchToolNode]),
    [
      [PermissionV2.node, permission],
      [WebSearch.node, websearch],
      [Form.node, form],
      [KV.node, kv],
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
        content: [{ type: "text", text: "## [Search results](https://example.com)\n\nsearch results" }],
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
          query: "effect typescript",
        },
      ])
    }),
  )

  it.effect("keeps normalized results in structured output", () =>
    Effect.gen(function* () {
      result = new WebSearch.Response({
        providerID: WebSearch.ID.make("parallel"),
        results: [
          {
            url: "https://effect.website",
            title: "Effect",
            content: "parallel results",
            time: { published: Date.parse("2026-07-25T00:00:00.000Z") },
          },
        ],
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
        output: {
          provider: "parallel",
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "parallel results",
              time: { published: Date.parse("2026-07-25T00:00:00.000Z") },
            },
          ],
        },
        content: [
          {
            type: "text",
            text: "## [Effect](https://effect.website)\nPublished: 2026-07-25T00:00:00.000Z\n\nparallel results",
          },
        ],
        metadata: { provider: "parallel" },
      })
    }),
  )

  it.effect("uses the concise no-results fallback", () =>
    Effect.gen(function* () {
      result = new WebSearch.Response({ providerID: WebSearch.ID.make("exa"), results: [] })
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
