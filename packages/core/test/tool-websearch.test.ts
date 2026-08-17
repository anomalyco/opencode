import { beforeEach, describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Stream } from "effect"
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Permission } from "@opencode-ai/core/permission"
import { Config } from "@opencode-ai/core/config"
import { Form } from "@opencode-ai/core/form"
import { WebSearch } from "@opencode-ai/core/websearch"
import { Document, Info } from "@opencode-ai/schema/config"
import { Session } from "@opencode-ai/core/session"
import { toSessionError } from "@opencode-ai/core/session/to-session-error"
import { Tool } from "@opencode-ai/core/tool"
import { WebSearchTool } from "@opencode-ai/core/tool/plugin/websearch"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Image } from "@opencode-ai/core/image"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"
import { webSearchHost } from "./plugin/host"
import { produce } from "immer"

const webSearchToolNode = makeLocationNode({
  name: "test/websearch-tool-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      yield* registerToolPlugin(WebSearchTool.Plugin, { websearch: webSearchHost(websearch) })
    }),
  ),
  deps: [Tool.node, Permission.node, WebSearch.node, Form.node, Config.node],
})

const sessionID = Session.ID.make("ses_websearch_test")
const assertions: Permission.AssertInput[] = []
const queries: WebSearch.Input[] = []
const formRequests: Form.CreateInput[] = []
let selection: WebSearch.ID | "random" | false | undefined
const providers = [
  { id: WebSearch.ID.make("exa"), name: "Exa" },
  { id: WebSearch.ID.make("parallel"), name: "Parallel" },
]
let providerRequired = false
let formResponse: Form.TerminalState = { status: "cancelled" }
const formResponses: Form.TerminalState[] = []
let queryBarrier: Deferred.Deferred<void> | undefined
let synchronizedQueries = 0
let queryError: WebSearch.Error | undefined
let result = new WebSearch.Response({
  providerID: WebSearch.ID.make("exa"),
  results: [{ url: "https://example.com", title: "Search results", content: "search results", time: {} }],
})

beforeEach(() => {
  assertions.length = 0
  queries.length = 0
  formRequests.length = 0
  selection = undefined
  providerRequired = false
  formResponse = { status: "cancelled" }
  formResponses.length = 0
  queryBarrier = undefined
  synchronizedQueries = 0
  queryError = undefined
  result = new WebSearch.Response({
    providerID: WebSearch.ID.make("exa"),
    results: [{ url: "https://example.com", title: "Search results", content: "search results", time: {} }],
  })
})

const permission = permissionLayer({
  assert: (input) => Effect.sync(() => assertions.push(input)),
})
const websearch = Layer.succeed(
  WebSearch.Service,
  WebSearch.Service.of({
    transform: (transform) =>
      Effect.sync(() => {
        transform({
          add: () => undefined,
          default: {
            get: () => selection,
            set: (next) => (selection = next),
          },
        })
        return { dispose: Effect.void }
      }),
    reload: () => Effect.die("unused"),
    providers: () => Effect.succeed(providers),
    default: () =>
      Effect.gen(function* () {
        if (selection === false) return yield* new WebSearch.DisabledError()
        return selection ? providers.find((provider) => provider.id === selection) : undefined
      }),
    query: (input) =>
      Effect.gen(function* () {
        queries.push(input)
        if (queryBarrier && synchronizedQueries < 5) {
          synchronizedQueries++
          if (synchronizedQueries === 5) yield* Deferred.succeed(queryBarrier, undefined)
          yield* Deferred.await(queryBarrier)
        }
        if (queryError) return yield* queryError
        if (providerRequired && !selection) return yield* new WebSearch.ProviderRequiredError()
        if (selection)
          return new WebSearch.Response({
            providerID: selection === "random" ? result.providerID : WebSearch.ID.make(selection),
            results: result.results,
          })
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
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Document({
          type: "document",
          info: new Info({
            websearch: selection === undefined ? undefined : selection === false ? false : { provider: selection },
          }),
        }),
      ]),
    update: (update) =>
      Effect.sync(() => {
        const info = produce(
          new Info({
            websearch: selection === undefined ? undefined : selection === false ? false : { provider: selection },
          }),
          update,
        )
        selection = info.websearch === false ? false : info.websearch?.provider
        return info
      }),
    changes: () => Stream.never,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, WebSearch.node, webSearchToolNode]), [
    [Permission.node, permission],
    [WebSearch.node, websearch],
    [Form.node, form],
    [Config.node, config],
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
      expect(selection).toBe("random")
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
                  label: "Allow search via Exa, Parallel",
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
      expect(selection).toBe(WebSearch.ID.make("parallel"))
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

  it.effect("shares provider consent across concurrent searches", () =>
    Effect.gen(function* () {
      providerRequired = true
      formResponse = { status: "answered", answer: { choice: "allow" } }
      queryBarrier = yield* Deferred.make<void>()
      const registry = yield* Tool.Service

      const results = yield* Effect.all(
        Array.from({ length: 5 }, (_, index) =>
          executeTool(registry, {
            sessionID,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: `call-concurrent-${index}`,
              name: "websearch",
              input: { query: `effect ${index}` },
            },
          }),
        ),
        { concurrency: "unbounded" },
      )

      expect(results.every((item) => item.status === "completed")).toBe(true)
      expect(formRequests).toHaveLength(1)
      expect(selection).toBe("random")
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
      expect(selection).toBe(false)
      expect(queries).toHaveLength(1)
    }),
  )

  it.effect("reports safe HTTP failures with the attempted provider", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const tools = yield* registry.snapshot()
      selection = WebSearch.ID.make("exa")

      yield* Effect.forEach(
        [
          { status: 403, message: "Web search request failed (HTTP 403)" },
          { status: 429, message: "Web search rate limited (HTTP 429)" },
          { status: 401, message: "Web search authentication failed (HTTP 401)" },
        ],
        ({ status, message }, index) =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post("https://mcp.exa.ai/mcp?exaApiKey=secret")
            queryError = new WebSearch.RequestError({
              providerID: WebSearch.ID.make("exa"),
              cause: new HttpClientError.HttpClientError({
                reason: new HttpClientError.StatusCodeError({
                  request,
                  response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
                  description: "non 2xx status code",
                }),
              }),
            })
            const progress: Tool.Metadata[] = []
            const error = yield* tools
              .execute({
                sessionID,
                ...toolIdentity,
                call: {
                  type: "tool-call",
                  id: `call-http-${index}`,
                  name: "websearch",
                  input: { query: "effect" },
                },
                progress: (metadata) => Effect.sync(() => progress.push(metadata)),
              })
              .pipe(Effect.flip)

            const sessionError = toSessionError(error)
            expect(sessionError).toEqual({ type: "tool.execution", message })
            expect(sessionError.message).not.toContain("secret")
            expect(error.metadata).toEqual({ provider: "exa" })
            expect(progress).toEqual([{ provider: "exa" }])
          }),
        { discard: true },
      )
    }),
  )
})
