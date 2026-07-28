import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Permission } from "@opencode-ai/core/permission"
import { Form } from "@opencode-ai/core/form"
import { KV } from "@opencode-ai/core/kv"
import { WebSearch } from "@opencode-ai/core/websearch"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { WebSearchTool } from "@opencode-ai/core/tool/plugin/websearch"
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
  deps: [Tool.node, Permission.node, WebSearch.node, Form.node, KV.node],
})

const sessionID = Session.ID.make("ses_websearch_test")
const assertions: Permission.AssertInput[] = []
const queries: WebSearch.Input[] = []
const formRequests: Form.CreateInput[] = []
const values = new Map<string, KV.Value>()
const providers = [
  { id: WebSearch.ID.make("exa"), name: "Exa" },
  { id: WebSearch.ID.make("parallel"), name: "Parallel" },
]
let providerRequired = false
let formResponse: Form.TerminalState = { status: "cancelled" }
const formResponses: Form.TerminalState[] = []
let result = new WebSearch.Response({
  providerID: WebSearch.ID.make("exa"),
  results: [{ url: "https://example.com", title: "Search results", content: "search results", time: {} }],
})

beforeEach(() => {
  assertions.length = 0
  queries.length = 0
  formRequests.length = 0
  values.clear()
  providerRequired = false
  formResponse = { status: "cancelled" }
  formResponses.length = 0
  result = new WebSearch.Response({
    providerID: WebSearch.ID.make("exa"),
    results: [{ url: "https://example.com", title: "Search results", content: "search results", time: {} }],
  })
})

const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
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
    providers: () => Effect.succeed(providers),
    default: () => Effect.succeed(undefined),
    query: (input) =>
      Effect.gen(function* () {
        queries.push(input)
        const stored = values.get("websearch:provider")
        if (providerRequired && typeof stored !== "string") return yield* new WebSearch.ProviderRequiredError()
        if (typeof stored === "string")
          return new WebSearch.Response({ providerID: WebSearch.ID.make(stored), results: result.results })
        return result
      }),
  }),
)
const form = Layer.succeed(
  Form.Service,
  Form.Service.of({
    create: () => Effect.die("unused"),
    ask: (input) =>
      Effect.sync(() => {
        formRequests.push(input)
        return formResponses.shift() ?? formResponse
      }),
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
    get: (key) => Effect.succeed(values.get(key)),
    set: (key, value) => Effect.sync(() => values.set(key, value)).pipe(Effect.asVoid),
    remove: (key) => Effect.sync(() => values.delete(key)).pipe(Effect.asVoid),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, WebSearch.node, webSearchToolNode]), [
    [Permission.node, permission],
    [WebSearch.node, websearch],
    [Form.node, form],
    [KV.node, kv],
    [Image.node, imagePassthrough],
  ]),
)

describe("WebSearchTool registration", () => {
  it.effect("asserts permission before delegating to WebSearch", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service

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
      const registry = yield* Tool.Service

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
      const registry = yield* Tool.Service

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

  it.effect("asks once and uses the default provider when web search is first enabled", () =>
    Effect.gen(function* () {
      providerRequired = true
      formResponse = { status: "answered", answer: { choice: "allow" } }
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-enable", name: "websearch", input: { query: "effect" } },
        }),
      ).toMatchObject({ status: "completed", metadata: { provider: "exa" } })
      expect(values.get("websearch:provider")).toBe("exa")
      expect(queries).toHaveLength(2)
      expect(formRequests).toEqual([
        {
          sessionID,
          title: "Web Search",
          metadata: { kind: "websearch.provider" },
          fields: [
            {
              key: "choice",
              description: "Allow OpenCode to search the web for up-to-date information?",
              type: "string",
              required: true,
              custom: false,
              options: [
                {
                  value: "allow",
                  label: "Allow web search via Exa",
                },
                {
                  value: "choose",
                  label: "Choose another provider",
                },
                { value: "disable", label: "Disable web search" },
              ],
            },
          ],
        },
      ])

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-enabled", name: "websearch", input: { query: "effect schema" } },
        }),
      ).toMatchObject({ status: "completed", metadata: { provider: "exa" } })
      expect(formRequests).toHaveLength(1)
      expect(queries).toHaveLength(3)
    }),
  )

  it.effect("asks a second form when choosing another provider", () =>
    Effect.gen(function* () {
      providerRequired = true
      formResponses.push(
        { status: "answered", answer: { choice: "choose" } },
        { status: "answered", answer: { provider: "parallel" } },
      )
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-choose", name: "websearch", input: { query: "effect" } },
        }),
      ).toMatchObject({ status: "completed", metadata: { provider: "parallel" } })
      expect(values.get("websearch:provider")).toBe("parallel")
      expect(queries).toHaveLength(2)
      expect(formRequests[1]).toEqual({
        sessionID,
        title: "Choose a web search provider",
        metadata: { kind: "websearch.provider" },
        fields: [
          {
            key: "provider",
            description: "Choose a provider for web search.",
            type: "string",
            required: true,
            custom: false,
            options: [
              { value: "exa", label: "Exa" },
              { value: "parallel", label: "Parallel" },
            ],
          },
        ],
      })
    }),
  )

  it.effect("persists the choice to disable web search", () =>
    Effect.gen(function* () {
      providerRequired = true
      formResponse = { status: "answered", answer: { choice: "disable" } }
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-disable", name: "websearch", input: { query: "effect" } },
        }),
      ).toMatchObject({ status: "error" })
      expect(values.get("websearch:provider")).toBe(false)
      expect(queries).toHaveLength(1)
    }),
  )
})
