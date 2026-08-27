import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Layer, Stream } from "effect"
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
  deps: [Tool.node, Permission.node, WebSearch.node, Form.node],
})

const sessionID = Session.ID.make("ses_websearch_test")
const providers = [
  { id: WebSearch.ID.make("exa"), name: "Exa" },
  { id: WebSearch.ID.make("parallel"), name: "Parallel" },
]

class Fixture {
  static Service = Context.Service<Fixture>("test/WebSearchFixture")

  assertions: Permission.AssertInput[] = []
  queries: WebSearch.Input[] = []
  formRequests: Form.CreateInput[] = []
  selection: WebSearch.ID | "random" | false | undefined
  providerRequired = false
  formResponse: Form.TerminalState = { status: "cancelled" }
  formResponses: Form.TerminalState[] = []
  queryBarrier: Deferred.Deferred<void> | undefined
  synchronizedQueries = 0
  queryError: WebSearch.Error | undefined
  result = new WebSearch.Response({
    providerID: WebSearch.ID.make("exa"),
    results: [{ url: "https://example.com", title: "Search results", content: "search results", time: {} }],
  })
}

const it = testEffect(
  Layer.unwrap(
    Effect.sync(() => {
      const fixture = new Fixture()
      const permission = permissionLayer({
        assert: (input) => Effect.sync(() => fixture.assertions.push(input)),
      })
      const websearch = Layer.succeed(
        WebSearch.Service,
        WebSearch.Service.of({
          transform: (transform) =>
            Effect.sync(() => {
              transform({
                add: () => undefined,
                default: {
                  get: () => fixture.selection,
                  set: (next) => (fixture.selection = next),
                },
              })
              return { dispose: Effect.void }
            }),
          reload: () => Effect.die("unused"),
          providers: () => Effect.succeed(providers),
          default: () =>
            Effect.gen(function* () {
              if (fixture.selection === false) return yield* new WebSearch.DisabledError()
              return fixture.selection ? providers.find((provider) => provider.id === fixture.selection) : undefined
            }),
          select: (next) => Effect.sync(() => (fixture.selection = next)),
          query: (input) =>
            Effect.gen(function* () {
              fixture.queries.push(input)
              if (fixture.queryBarrier && fixture.synchronizedQueries < 5) {
                fixture.synchronizedQueries++
                if (fixture.synchronizedQueries === 5) yield* Deferred.succeed(fixture.queryBarrier, undefined)
                yield* Deferred.await(fixture.queryBarrier)
              }
              if (fixture.queryError) return yield* fixture.queryError
              if (fixture.providerRequired && !fixture.selection) return yield* new WebSearch.ProviderRequiredError()
              if (fixture.selection)
                return new WebSearch.Response({
                  providerID:
                    fixture.selection === "random" ? fixture.result.providerID : WebSearch.ID.make(fixture.selection),
                  results: fixture.result.results,
                })
              return fixture.result
            }),
        }),
      )
      const form = Layer.mock(Form.Service, {
        ask: (input) =>
          Effect.sync(() => {
            fixture.formRequests.push(input)
            return fixture.formResponses.shift() ?? fixture.formResponse
          }),
      })
      const config = Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () =>
            Effect.succeed([
              new Document({
                type: "document",
                info: new Info({
                  websearch:
                    fixture.selection === undefined
                      ? undefined
                      : fixture.selection === false
                        ? false
                        : { provider: fixture.selection },
                }),
              }),
            ]),
          update: (update) =>
            Effect.sync(() => {
              const info = produce(
                new Info({
                  websearch:
                    fixture.selection === undefined
                      ? undefined
                      : fixture.selection === false
                        ? false
                        : { provider: fixture.selection },
                }),
                update,
              )
              fixture.selection = info.websearch === false ? false : info.websearch?.provider
              return info
            }),
          changes: () => Stream.never,
        }),
      )
      return Layer.merge(
        Layer.succeed(Fixture.Service, fixture),
        AppNodeBuilder.build(LayerNode.group([Tool.node, WebSearch.node, webSearchToolNode]), [
          [Permission.node, permission],
          [WebSearch.node, websearch],
          [Form.node, form],
          [Config.node, config],
          [Image.node, imagePassthrough],
        ]),
      )
    }),
  ),
)

describe("WebSearchTool registration", () => {
  it.effect("asserts permission before delegating to WebSearch", () =>
    Effect.gen(function* () {
      const fixture = yield* Fixture.Service
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
      expect(fixture.assertions).toMatchObject([
        {
          sessionID,
          action: "websearch",
          resources: ["effect typescript"],
          save: ["*"],
          metadata: { query: "effect typescript" },
        },
      ])
      expect(fixture.queries).toEqual([
        {
          query: "effect typescript",
        },
      ])
    }),
  )

  it.effect("keeps normalized results in structured output", () =>
    Effect.gen(function* () {
      const fixture = yield* Fixture.Service
      fixture.result = new WebSearch.Response({
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
      const fixture = yield* Fixture.Service
      fixture.result = new WebSearch.Response({ providerID: WebSearch.ID.make("exa"), results: [] })
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
      const fixture = yield* Fixture.Service
      fixture.providerRequired = true
      fixture.formResponse = { status: "answered", answer: { choice: "allow" } }
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-enable", name: "websearch", input: { query: "effect" } },
        }),
      ).toMatchObject({ status: "completed", metadata: { provider: "exa" } })
      expect(fixture.selection).toBe("random")
      expect(fixture.queries).toHaveLength(2)
      expect(fixture.formRequests).toEqual([
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
      expect(fixture.formRequests).toHaveLength(1)
      expect(fixture.queries).toHaveLength(3)
    }),
  )

  it.effect("asks a second form when choosing another provider", () =>
    Effect.gen(function* () {
      const fixture = yield* Fixture.Service
      fixture.providerRequired = true
      fixture.formResponses.push(
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
      expect(fixture.selection).toBe(WebSearch.ID.make("parallel"))
      expect(fixture.queries).toHaveLength(2)
      expect(fixture.formRequests[1]).toEqual({
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
      const fixture = yield* Fixture.Service
      fixture.providerRequired = true
      fixture.formResponse = { status: "answered", answer: { choice: "allow" } }
      fixture.queryBarrier = yield* Deferred.make<void>()
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
      expect(fixture.formRequests).toHaveLength(1)
      expect(fixture.selection).toBe("random")
    }),
  )

  it.effect("persists the choice to disable web search", () =>
    Effect.gen(function* () {
      const fixture = yield* Fixture.Service
      fixture.providerRequired = true
      fixture.formResponse = { status: "answered", answer: { choice: "disable" } }
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-disable", name: "websearch", input: { query: "effect" } },
        }),
      ).toMatchObject({ status: "error" })
      expect(fixture.selection).toBe(false)
      expect(fixture.queries).toHaveLength(1)
    }),
  )

  it.effect("reports safe HTTP failures with the attempted provider", () =>
    Effect.gen(function* () {
      const fixture = yield* Fixture.Service
      const registry = yield* Tool.Service
      const tools = yield* registry.snapshot()
      fixture.selection = WebSearch.ID.make("exa")

      yield* Effect.forEach(
        [
          { status: 403, message: "Web search request failed (HTTP 403)" },
          { status: 429, message: "Web search rate limited (HTTP 429)" },
          { status: 401, message: "Web search authentication failed (HTTP 401)" },
        ],
        ({ status, message }, index) =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post("https://mcp.exa.ai/mcp?exaApiKey=secret")
            fixture.queryError = new WebSearch.RequestError({
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
