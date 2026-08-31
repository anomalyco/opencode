import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Permission } from "@opencode-ai/core/permission"
import { KV } from "@opencode-ai/core/kv"
import { Form } from "@opencode-ai/core/form"
import { WebSearch } from "@opencode-ai/core/websearch"
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
import { TestWebSearch } from "./lib/websearch"

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
  assertions: Permission.AssertInput[] = []
  events: string[] = []
  formRequests: Form.CreateInput[] = []
  formResponse: Form.TerminalState = { status: "cancelled" }
  formResponses: Form.TerminalState[] = []
  formWait = Effect.void
  error: HttpClientError.HttpClientError | undefined
  results: readonly WebSearch.Result[] = [
    { url: "https://example.com", title: "Search results", content: "search results", time: {} },
  ]
}

const it = testEffect(TestWebSearch.layer)
const setup = Effect.gen(function* () {
  const fixture = new Fixture()
  const websearch = yield* TestWebSearch.Service
  const kv = yield* KV.Service
  yield* websearch.transform((draft) =>
    providers.forEach((provider) =>
      draft.add({
        ...provider,
        execute: () =>
          Effect.gen(function* () {
            fixture.events.push("query")
            if (fixture.error) return yield* fixture.error
            return fixture.results
          }),
      }),
    ),
  )
  const context = yield* Layer.build(
    AppNodeBuilder.build(LayerNode.group([Tool.node, webSearchToolNode]), [
      Permission.node.replace(
        permissionLayer({
          assert: (input) =>
            Effect.sync(() => {
              fixture.events.push("permission")
              fixture.assertions.push(input)
            }),
        }),
      ),
      WebSearch.node.replace(Layer.succeed(WebSearch.Service, websearch)),
      Form.node.replace(
        Layer.mock(Form.Service, {
          ask: (input) =>
            Effect.gen(function* () {
              fixture.formRequests.push(input)
              yield* fixture.formWait
              return fixture.formResponses.shift() ?? fixture.formResponse
            }),
        }),
      ),
      Image.node.replace(imagePassthrough),
    ]),
  )
  return Object.assign(fixture, { websearch, kv, registry: Context.get(context, Tool.Service) })
})

describe("WebSearchTool registration", () => {
  it.effect("asserts permission before delegating to WebSearch", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const registry = fixture.registry
      yield* fixture.websearch.select(WebSearch.ID.make("exa"))

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
      expect(fixture.websearch.queries).toEqual([
        {
          query: "effect typescript",
          providerID: WebSearch.ID.make("exa"),
        },
      ])
      expect(fixture.events).toEqual(["permission", "query"])
    }),
  )

  it.effect("keeps normalized results in structured output", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      yield* fixture.websearch.select(WebSearch.ID.make("parallel"))
      fixture.results = [
        {
          url: "https://effect.website",
          title: "Effect",
          content: "parallel results",
          time: { published: Date.parse("2026-07-25T00:00:00.000Z") },
        },
      ]
      const registry = fixture.registry

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
      const fixture = yield* setup
      yield* fixture.websearch.select(WebSearch.ID.make("exa"))
      fixture.results = []
      const registry = fixture.registry

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
      const fixture = yield* setup
      fixture.formResponse = { status: "answered", answer: { choice: "allow" } }
      const registry = fixture.registry

      const first = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-enable", name: "websearch", input: { query: "effect" } },
      })
      expect(first.status).toBe("completed")
      expect(["exa", "parallel"]).toContain(first.metadata?.provider)
      expect(first.metadata?.provider).toBe(fixture.websearch.queries[1]?.providerID)
      expect(yield* fixture.kv.get(WebSearch.ProviderKey)).toBe("random")
      expect(fixture.websearch.queries).toHaveLength(2)
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

      const second = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-enabled", name: "websearch", input: { query: "effect schema" } },
      })
      expect(second.status).toBe("completed")
      expect(["exa", "parallel"]).toContain(second.metadata?.provider)
      expect(second.metadata?.provider).toBe(fixture.websearch.queries[2]?.providerID)
      expect(fixture.formRequests).toHaveLength(1)
      expect(fixture.websearch.queries).toHaveLength(3)
    }),
  )

  it.effect("asks a second form when choosing another provider", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      fixture.formResponses.push(
        { status: "answered", answer: { choice: "choose" } },
        { status: "answered", answer: { provider: "parallel" } },
      )
      const registry = fixture.registry

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-choose", name: "websearch", input: { query: "effect" } },
        }),
      ).toMatchObject({ status: "completed", metadata: { provider: "parallel" } })
      expect(yield* fixture.kv.get(WebSearch.ProviderKey)).toBe(WebSearch.ID.make("parallel"))
      expect(fixture.websearch.queries).toHaveLength(2)
      expect(fixture.websearch.queries[1]?.providerID).toBe(WebSearch.ID.make("parallel"))
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
      const fixture = yield* setup
      fixture.formResponse = { status: "answered", answer: { choice: "allow" } }
      fixture.formWait = fixture.websearch.wait(5)
      const registry = fixture.registry

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
      expect(yield* fixture.kv.get(WebSearch.ProviderKey)).toBe("random")
    }),
  )

  it.effect("persists the choice to disable web search", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      fixture.formResponse = { status: "answered", answer: { choice: "disable" } }
      const registry = fixture.registry

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-disable", name: "websearch", input: { query: "effect" } },
        }),
      ).toMatchObject({ status: "error" })
      expect(yield* fixture.kv.get(WebSearch.ProviderKey)).toBe(false)
      expect(yield* fixture.websearch.default().pipe(Effect.flip)).toBeInstanceOf(WebSearch.DisabledError)
      expect(fixture.websearch.queries).toHaveLength(1)
    }),
  )

  it.effect("reports safe HTTP failures with the attempted provider", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const registry = fixture.registry
      const tools = yield* registry.snapshot()
      yield* fixture.websearch.select(WebSearch.ID.make("exa"))

      yield* Effect.forEach(
        [
          { status: 403, message: "Web search request failed (HTTP 403)" },
          { status: 429, message: "Web search rate limited (HTTP 429)" },
          { status: 401, message: "Web search authentication failed (HTTP 401)" },
        ],
        ({ status, message }, index) =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post("https://mcp.exa.ai/mcp?exaApiKey=secret")
            fixture.error = new HttpClientError.HttpClientError({
              reason: new HttpClientError.StatusCodeError({
                request,
                response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
                description: "non 2xx status code",
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
