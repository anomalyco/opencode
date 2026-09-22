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
import { AlexandriaTool } from "@opencode/core/tool/plugin/alexandria"
import { WebSearch } from "@opencode/core/websearch"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"
import { host, integrationHost, webSearchHost } from "./plugin/host"

const sessionID = Session.ID.make("ses_alexandria_test")
const integrationID = Integration.ID.make(WebSearchFirecrawl.integrationID)
const providers = JSON.stringify({
  success: true,
  data: {
    tools: [{ provider: "fred", capability: "series/observations", description: "FRED economic time series" }],
  },
})
const records = JSON.stringify({
  success: true,
  data: { alexandria: [{ provider: "fred", capability: "series/observations", result: { observations: [] } }] },
})
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

const alexandriaToolNode = makeLocationNode({
  name: "test/alexandria-tool-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      // The web search provider registers the Firecrawl integration and its key method; alexandria only reads the connection.
      yield* WebSearchFirecrawl.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      yield* registerToolPlugin(AlexandriaTool.Plugin, {
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
  AppNodeBuilder.build(LayerNode.group([Tool.node, Integration.node, alexandriaToolNode]), [
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
  response = { body: mcp(providers), status: 200 }
})

const call = (input: Record<string, unknown>, id = "call-alexandria") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: AlexandriaTool.name, input },
})

const find = { query: "us inflation" }
const run = { provider: "fred", capability: "series/observations", options: { series_id: "CPIAUCSL" } }

const context = (): SessionHooks["context"] => ({
  sessionID,
  agent: toolIdentity.agent,
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test") }),
  system: [],
  messages: [],
  tools: Object.fromEntries(
    [AlexandriaTool.name, "websearch"].map((name) => [name, { description: name, input: { type: "object" } }]),
  ),
  options: {},
})

const connect = Effect.gen(function* () {
  const integrations = yield* Integration.Service
  yield* integrations.connection.key({ integrationID, key: "fc-secret" })
})

describe("AlexandriaTool", () => {
  it.effect("hides the tool from sessions until Firecrawl is connected", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain(AlexandriaTool.name)
      expect([...hooks.keys()].sort()).toEqual(["compaction", "context", "generate"])

      const hidden = context()
      yield* hooks.get("context")!(hidden)
      expect(Object.keys(hidden.tools)).toEqual(["websearch"])

      yield* connect
      const shown = context()
      yield* hooks.get("generate")!(shown)
      expect(Object.keys(shown.tools).sort()).toEqual([AlexandriaTool.name, "websearch"])
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
      expect(Object.keys(event.tools)).toContain(AlexandriaTool.name)
    }),
  )

  it.effect("fails without a request when Firecrawl is not connected", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call(find))).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: AlexandriaTool.NOT_CONNECTED },
      })
      expect(requests).toHaveLength(0)
      expect(assertions).toHaveLength(0)
    }),
  )

  it.effect("rejects input that neither finds nor runs", () =>
    Effect.gen(function* () {
      yield* connect
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call({}))).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: AlexandriaTool.INVALID_INPUT },
      })
      expect(yield* executeTool(registry, call({ ...find, ...run }, "call-both"))).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: AlexandriaTool.INVALID_INPUT },
      })
      expect(requests).toHaveLength(0)
      expect(assertions).toHaveLength(0)
    }),
  )

  it.effect("asserts permission and finds providers through firecrawl_search", () =>
    Effect.gen(function* () {
      yield* connect
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call(find))).toMatchObject({
        status: "completed",
        output: { output: providers },
        content: [{ type: "text", text: providers }],
      })
      expect(assertions).toMatchObject([{ action: AlexandriaTool.name, resources: ["us inflation"] }])
      expect(requests).toMatchObject([
        {
          url: WebSearchFirecrawl.endpoint,
          headers: { authorization: "Bearer fc-secret" },
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "firecrawl_search",
              arguments: { query: "us inflation", sources: ["alexandria"], limit: 5, toolDetail: "full" },
            },
          },
        },
      ])
    }),
  )

  it.effect("runs a capability through firecrawl_scrape", () =>
    Effect.gen(function* () {
      yield* connect
      response = { body: mcp(records), status: 200 }
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call(run))).toMatchObject({
        status: "completed",
        output: { output: records },
        content: [{ type: "text", text: records }],
      })
      expect(assertions).toMatchObject([{ action: AlexandriaTool.name, resources: ["fred/series/observations"] }])
      expect(requests).toMatchObject([
        {
          url: WebSearchFirecrawl.endpoint,
          headers: { authorization: "Bearer fc-secret" },
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "firecrawl_scrape", arguments: { alexandria: run } },
          },
        },
      ])
    }),
  )

  it.effect("reports empty responses as no results", () =>
    Effect.gen(function* () {
      yield* connect
      response = { body: mcp(""), status: 200 }
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call(find))).toMatchObject({
        status: "completed",
        output: { output: AlexandriaTool.NO_PROVIDERS },
      })
      expect(yield* executeTool(registry, call(run, "call-run"))).toMatchObject({
        status: "completed",
        output: { output: AlexandriaTool.NO_DATA },
      })
    }),
  )

  it.effect("surfaces HTTP failures as tool errors", () =>
    Effect.gen(function* () {
      yield* connect
      response = { body: "Rate limited", status: 429 }
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call(find))).toMatchObject({ status: "error" })
      expect(requests).toHaveLength(1)
    }),
  )
})
