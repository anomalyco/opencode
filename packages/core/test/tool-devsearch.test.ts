import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Form } from "@opencode/core/form"
import { Image } from "@opencode/core/image"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { WebSearchFirecrawl } from "@opencode/core/plugin/websearch/firecrawl"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { DevSearchTool } from "@opencode/core/tool/plugin/devsearch"
import { WebSearch } from "@opencode/core/websearch"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"
import { host, integrationHost, webSearchHost } from "./plugin/host"

const sessionID = Session.ID.make("ses_devsearch_test")
const integrationID = Integration.ID.make(WebSearchFirecrawl.integrationID)
const passages =
  "## [issue:effect-ts/effect#1234] (issue) Retrying HttpClient requests\nhttps://github.com/effect-ts/effect/issues/1234\nUse Effect.retry with a Schedule."
const requests: Array<{ readonly url: string; readonly headers: Record<string, string>; readonly body: unknown }> = []
const assertions: Permission.AssertInput[] = []
const hooks = new Map<string, (event: SessionHooks["context"]) => Effect.Effect<void>>()
let response = { body: "", status: 200 }

const mcp = (text: string) =>
  `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } })}\n\n`

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
      return HttpClientResponse.fromWeb(request, new Response(response.body, { status: response.status }))
    }),
  ),
)

const devSearchToolNode = makeLocationNode({
  name: "test/devsearch-tool-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      // The web search provider registers the Firecrawl integration and its key method; devsearch only reads the connection.
      yield* WebSearchFirecrawl.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      yield* registerToolPlugin(DevSearchTool.Plugin, {
        integration: integrationHost(integrations),
        session: {
          hook: (name, callback) =>
            Effect.sync(() => {
              hooks.set(name, callback as (event: SessionHooks["context"]) => Effect.Effect<void>)
              return { dispose: Effect.void }
            }),
        },
      })
    }),
  ),
  deps: [
    Tool.node,
    Permission.node,
    Integration.node,
    Credential.node,
    Bus.node,
    Form.node,
    WebSearch.node,
    LayerNodePlatform.httpClient,
  ],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, Integration.node, devSearchToolNode]), [
    Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => assertions.push(input)) })),
    Image.node.replace(imagePassthrough),
    Config.node.replace(Config.testLayer()),
    LayerNodePlatform.httpClient.replace(http),
  ]),
)

beforeEach(() => {
  requests.length = 0
  assertions.length = 0
  hooks.clear()
  response = { body: mcp(passages), status: 200 }
})

const call = (query: string, id = "call-devsearch") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: DevSearchTool.name, input: { query } },
})

const context = (): SessionHooks["context"] => ({
  sessionID,
  agent: toolIdentity.agent,
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test") }),
  system: [],
  messages: [],
  tools: Object.fromEntries(
    [DevSearchTool.name, "websearch"].map((name) => [name, { description: name, input: { type: "object" } }]),
  ),
  options: {},
})

const connect = Effect.gen(function* () {
  const integrations = yield* Integration.Service
  yield* integrations.connection.key({ integrationID, key: "fc-secret" })
})

describe("DevSearchTool", () => {
  it.effect("hides the tool from sessions until Firecrawl is connected", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain(DevSearchTool.name)
      expect([...hooks.keys()].sort()).toEqual(["compaction", "context", "generate"])

      const hidden = context()
      yield* hooks.get("context")!(hidden)
      expect(Object.keys(hidden.tools)).toEqual(["websearch"])

      yield* connect
      const shown = context()
      yield* hooks.get("generate")!(shown)
      expect(Object.keys(shown.tools).sort()).toEqual([DevSearchTool.name, "websearch"])
    }),
  )

  it.effect("treats FIRECRAWL_API_KEY as a connection", () =>
    Effect.gen(function* () {
      const previous = process.env.FIRECRAWL_API_KEY
      process.env.FIRECRAWL_API_KEY = "fc-env"
      const event = context()
      yield* hooks.get("compaction")!(event).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.FIRECRAWL_API_KEY
            else process.env.FIRECRAWL_API_KEY = previous
          }),
        ),
      )
      expect(Object.keys(event.tools)).toContain(DevSearchTool.name)
    }),
  )

  it.effect("fails without a request when Firecrawl is not connected", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call("effect retry"))).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: DevSearchTool.NOT_CONNECTED },
      })
      expect(requests).toHaveLength(0)
      expect(assertions).toHaveLength(0)
    }),
  )

  it.effect("asserts permission and returns the developer index passages", () =>
    Effect.gen(function* () {
      yield* connect
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call("effect retry"))).toMatchObject({
        status: "completed",
        output: { output: passages },
        content: [{ type: "text", text: passages }],
      })
      expect(assertions).toMatchObject([{ action: DevSearchTool.name, resources: ["effect retry"] }])
      expect(requests).toMatchObject([
        {
          url: WebSearchFirecrawl.endpoint,
          headers: { authorization: "Bearer fc-secret" },
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "firecrawl_developer_search", arguments: { query: "effect retry", k: 8 } },
          },
        },
      ])
    }),
  )

  it.effect("reports an empty index response as no results", () =>
    Effect.gen(function* () {
      yield* connect
      response = { body: mcp(""), status: 200 }
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call("nothing here"))).toMatchObject({
        status: "completed",
        output: { output: DevSearchTool.NO_RESULTS },
        content: [{ type: "text", text: DevSearchTool.NO_RESULTS }],
      })
    }),
  )

  it.effect("surfaces HTTP failures as tool errors", () =>
    Effect.gen(function* () {
      yield* connect
      response = { body: "Rate limited", status: 429 }
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call("effect retry"))).toMatchObject({ status: "error" })
      expect(requests).toHaveLength(1)
    }),
  )
})
