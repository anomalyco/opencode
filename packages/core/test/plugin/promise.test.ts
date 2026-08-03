import { describe, expect } from "bun:test"
import { Message, SystemPart } from "@opencode-ai/ai"
import { DateTime, Deferred, Effect, Fiber, Schema } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { WebSearch } from "@opencode-ai/core/websearch"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionPending } from "@opencode-ai/core/session/pending"
import { Tool } from "@opencode-ai/core/tool"
import { Provider } from "@opencode-ai/core/provider"
import { define } from "@opencode-ai/plugin/promise/plugin"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { host as testHost } from "./host"

const it = testEffect(PluginTestLayer)

describe("fromPromise", () => {
  it.effect("forwards transient session generation", () =>
    Effect.gen(function* () {
      const host = testHost({
        session: {
          generate: (input) => Effect.succeed({ text: `${input.sessionID}: ${input.prompt}` }),
        },
      })

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-generate",
          setup: async (ctx) => {
            expect(await ctx.session.generate({ sessionID: "ses_generate", prompt: "Summarize" })).toEqual({
              text: "ses_generate: Summarize",
            })
          },
        }),
      ).effect(host)
    }),
  )

  it.effect("forwards synthetic session input", () =>
    Effect.gen(function* () {
      const input = {
        sessionID: "ses_synthetic",
        id: "msg_synthetic",
        text: "Background work completed",
        description: null,
        metadata: { shellID: "shell_1" },
        delivery: null,
        resume: null,
      }
      let seen: unknown
      const host = testHost({
        session: {
          synthetic: (value) => {
            seen = value
            return Effect.succeed(
              SessionPending.Synthetic.make({
                id: SessionMessage.ID.make(input.id),
                sessionID: Session.ID.make(input.sessionID),
                timeCreated: DateTime.makeUnsafe(0),
                type: "synthetic",
                data: {
                  text: input.text,
                  metadata: input.metadata,
                },
                delivery: "queue",
              }),
            )
          },
        },
      })

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-synthetic",
          setup: async (ctx) => {
            await ctx.session.synthetic(input)
          },
        }),
      ).effect(host)

      expect(seen).toEqual({
        ...input,
        description: undefined,
        delivery: undefined,
        resume: undefined,
      })
    }),
  )

  it.effect("forwards standard client reads", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const seen: string[] = []
      const promisePlugin = define({
        id: "promise-client-reads",
        setup: async (ctx) => {
          const results = await Promise.all([
            ctx.agent.list(),
            ctx.catalog.provider.list(),
            ctx.catalog.model.list(),
            ctx.command.list(),
            ctx.integration.list(),
            ctx.plugin.list(),
            ctx.reference.list(),
            ctx.skill.list(),
          ])
          seen.push(...results.map((result) => result.location.directory))
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)

      expect(seen).toHaveLength(8)
      expect(new Set(seen).size).toBe(1)
    }),
  )

  it.effect("forwards direct agent and model list reads", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const catalog = yield* Catalog.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* agents.transform((draft) =>
        draft.update(Agent.ID.make("reviewer"), (agent) => {
          agent.description = "Reviews code"
        }),
      )
      yield* catalog.transform((draft) =>
        draft.model.update(Provider.ID.make("test"), Model.ID.make("alias"), (model) => {
          model.modelID = Model.ID.make("gpt-5")
        }),
      )

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-direct-reads",
          setup: async (ctx) => {
            expect((await ctx.agent.get({ agentID: Agent.ID.make("reviewer") })).data).toMatchObject({
              description: "Reviews code",
            })
            await expect(ctx.agent.get({ agentID: Agent.ID.make("missing") })).rejects.toThrow(
              "Agent not found: missing",
            )
            const models = (await ctx.catalog.model.list()).data
            expect(models.find((model) => model.providerID === "test" && model.id === "alias")).toMatchObject({
              modelID: "gpt-5",
            })
            expect(models.find((model) => model.providerID === "test" && model.id === "missing")).toBeUndefined()
          },
        }),
      ).effect(host)
    }),
  )

  it.effect("loads a promise plugin and registers a transform hook", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = define({
        id: "promise-example",
        setup: async (ctx) => {
          expect(ctx.options.mode).toBe("strict")
          await ctx.agent.transform((draft) => {
            draft.update("reviewer", (item) => {
              item.description = "Reviews code"
              item.mode = "subagent"
            })
          })
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect({ ...host, options: { mode: "strict" } })

      expect(yield* agents.get(Agent.ID.make("reviewer"))).toMatchObject({
        description: "Reviews code",
        mode: "subagent",
      })
    }),
  )

  it.effect("forwards session context hooks", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const hooks = yield* PluginHooks.Service
      const host = yield* PluginHost.make(plugin)
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-context",
          setup: async (ctx) => {
            await ctx.session.hook("context", (event) => {
              event.system.push(SystemPart.make("Promise hook"))
              delete event.tools.echo
            })
          },
        }),
      ).effect(host)
      const event: SessionHooks["context"] = {
        sessionID: Session.ID.make("ses_promise_session_context"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
        system: [SystemPart.make("Initial")],
        messages: [Message.user("Hello")],
        tools: { echo: { description: "Echo", input: { type: "object" } } },
      }

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual(["Initial", "Promise hook"])
      expect(event.tools).toEqual({})
    }),
  )

  it.effect("adapts promise session HTTP hooks", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const hooks = yield* PluginHooks.Service
      const host = yield* PluginHost.make(plugin)
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-http",
          setup: async (ctx) => {
            await ctx.session.hook("http", (event) => {
              const request = event.request
              event.request = async (input) => {
                const response = await request(new Request(input, { headers: { "x-hook": "promise" } }))
                return new Response(`${await response.text()}-response`)
              }
            })
          },
        }),
      ).effect(host)
      const event: SessionHooks["http"] = {
        sessionID: Session.ID.make("ses_promise_session_http"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
        request: (input) => Effect.succeed(new Response(input.headers.get("x-hook") ?? "missing")),
      }

      yield* hooks.trigger("session", "http", event)
      const response = yield* event.request(new Request("https://provider.test"))

      expect(yield* Effect.promise(() => response.text())).toBe("promise-response")
    }),
  )

  it.effect("interrupts the Effect request through a promise session HTTP hook", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const hooks = yield* PluginHooks.Service
      const host = yield* PluginHost.make(plugin)
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-http-interrupt",
          setup: async (ctx) => {
            await ctx.session.hook("http", (event) => {
              const request = event.request
              event.request = (input) => request(input)
            })
          },
        }),
      ).effect(host)
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const event: SessionHooks["http"] = {
        sessionID: Session.ID.make("ses_promise_session_http_interrupt"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
        request: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
      }

      yield* hooks.trigger("session", "http", event)
      const fiber = yield* event.request(new Request("https://provider.test")).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)

      expect(yield* Deferred.isDone(interrupted)).toBeTrue()
    }),
  )

  it.effect("disposes a hook registration on request", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = define({
        id: "promise-dispose",
        setup: async (ctx) => {
          const registration = await ctx.agent.transform((draft) => {
            draft.update("temp", (item) => {
              item.description = "temporary"
            })
          })
          await registration.dispose()
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect(host)

      expect(yield* agents.get(Agent.ID.make("temp"))).toBeUndefined()
    }),
  )

  it.effect("registers a standalone web search provider", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const promisePlugin = define({
        id: "promise-websearch",
        setup: async (ctx) => {
          await ctx.websearch.transform((draft) => {
            draft.add({
              id: "promise-websearch",
              name: "Promise Web Search",
              execute: async (input) => [{ url: "https://example.com", content: `promise: ${input.query}`, time: {} }],
            })
          })
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)
      expect(yield* websearch.providers()).toContainEqual({
        id: WebSearch.ID.make("promise-websearch"),
        name: "Promise Web Search",
      })
      expect(yield* websearch.query({ query: "effect", providerID: WebSearch.ID.make("promise-websearch") })).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("promise-websearch"),
          results: [{ url: "https://example.com", content: "promise: effect", time: {} }],
        }),
      )
    }),
  )

  it.effect("runs the setup cleanup when the plugin scope closes", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const events: string[] = []
      const promisePlugin = define({
        id: "promise-cleanup",
        setup: async () => {
          events.push("setup")
          return async () => {
            await Promise.resolve()
            events.push("cleanup")
          }
        },
      })

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* PluginPromise.fromPromise(promisePlugin).effect(host)
          expect(events).toEqual(["setup"])
        }),
      )

      expect(events).toEqual(["setup", "cleanup"])
    }),
  )

  it.effect("constructs plain Promise tool definitions in the host", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const registry = yield* Tool.Service
      const host = yield* PluginHost.make(plugins)
      const progress: Tool.Metadata[] = []
      const promisePlugin = define({
        id: "promise-tool",
        setup: async (ctx) => {
          await ctx.tool.transform((tools) => {
            tools.add({
              name: "hello",
              options: { codemode: false },
              description: "Hello",
              input: Schema.Struct({ name: Schema.String }),
              output: Schema.String,
              execute: async ({ name }, context) => {
                await context.progress({ phase: "greeting" })
                return { output: `Hello, ${name}!` }
              },
            })
          })
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)

      const toolSet = yield* registry.snapshot()
      expect(toolSet.definitions).toContainEqual(expect.objectContaining({ name: "hello", description: "Hello" }))
      expect(
        yield* toolSet.execute({
          sessionID: Session.ID.make("ses_promise_tool"),
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_promise_tool"),
          progress: (update) => Effect.sync(() => progress.push(update)),
          call: { type: "tool-call", id: "call_promise_tool", name: "hello", input: { name: "world" } },
        }),
      ).toMatchObject({
        output: "Hello, world!",
        content: [{ type: "text", text: "Hello, world!" }],
      })
      expect(progress).toEqual([{ phase: "greeting" }])
    }),
  )
})
