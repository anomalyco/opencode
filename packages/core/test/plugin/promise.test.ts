import { describe, expect } from "bun:test"
import { Message, SystemPart } from "@opencode-ai/ai"
import { DateTime, Deferred, Effect, Schema, Stream } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { Location } from "@opencode-ai/core/location"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { WebSearch } from "@opencode-ai/core/websearch"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { Tool } from "@opencode-ai/core/tool"
import { Provider } from "@opencode-ai/core/provider"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { define } from "@opencode-ai/plugin/promise/plugin"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { Money } from "@opencode-ai/schema/money"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { host as testHost } from "./host"

const it = testEffect(PluginTestLayer)

describe("fromPromise", () => {
  it.effect("adapts session creation through the protocol schema", () =>
    Effect.gen(function* () {
      let seen: unknown
      const host = testHost({
        session: {
          create: (input) => {
            seen = input
            return Effect.succeed(
              Session.Info.make({
                id: Session.ID.make("ses_protocol_adapter"),
                projectID: Project.ID.make("project"),
                cost: Money.USD.make(0),
                tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
                time: { created: DateTime.makeUnsafe(10), updated: DateTime.makeUnsafe(20) },
                title: input?.title,
                location: Location.Ref.make({ directory: AbsolutePath.make("/workspace") }),
              }),
            )
          },
        },
      })

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-create",
          setup: async (ctx) => {
            await expect(Reflect.apply(ctx.session.create, undefined, [{ title: 42 }])).rejects.toBeDefined()
            const result = await ctx.session.create({
              id: null,
              title: "Promise title",
              agent: null,
              model: null,
              location: null,
            })
            expect(result).toMatchObject({
              id: "ses_protocol_adapter",
              title: "Promise title",
              time: { created: 10, updated: 20 },
            })
          },
        }),
      ).effect(host)

      expect(seen).toEqual({ title: "Promise title" })
    }),
  )

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

  it.effect("preserves no-content and rejected Promise behavior", () =>
    Effect.gen(function* () {
      const seen: unknown[] = []
      const host = testHost({
        session: {
          interrupt: (input) => {
            if (input.sessionID === Session.ID.make("ses_failure")) {
              return Effect.fail(new Error("interrupt failed"))
            }
            expect(input.continue).toBe(true)
            return Effect.void
          },
          rename: (input) => Effect.sync(() => seen.push(input)),
          wait: (input) => Effect.sync(() => seen.push(input)),
        },
      })

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-interrupt",
          setup: async (ctx) => {
            expect(await ctx.session.interrupt({ sessionID: "ses_success", continue: true })).toBeUndefined()
            await expect(ctx.session.interrupt({ sessionID: "ses_failure" })).rejects.toThrow("interrupt failed")
            expect(await ctx.session.rename({ sessionID: "ses_success", title: "Renamed" })).toBeUndefined()
            expect(await ctx.session.wait({ sessionID: "ses_success" })).toBeUndefined()
          },
        }),
      ).effect(host)

      expect(seen).toEqual([
        { sessionID: Session.ID.make("ses_success"), title: "Renamed" },
        { sessionID: Session.ID.make("ses_success") },
      ])
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
              SessionInbox.Synthetic.make({
                id: SessionMessage.ID.make(input.id),
                sessionID: Session.ID.make(input.sessionID),
                timeCreated: DateTime.makeUnsafe(0),
                type: "synthetic",
                payload: {
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
          expect((await ctx.integration.get({ integrationID: "missing" })).data).toBeNull()
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

  it.effect("adapts promise session HTTP request and response hooks", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const hooks = yield* PluginHooks.Service
      const host = yield* PluginHost.make(plugin)
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-http",
          setup: async (ctx) => {
            await ctx.session.hook(
              "http.request",
              (event) => {
                event.request = new Request("https://provider.test/changed", event.request)
                event.request.headers.set("x-hook", "promise")
              },
              { providerID: "test" },
            )
            await ctx.session.hook("http.response", async (event) => {
              event.response = new Response(`${await event.response.text()}-response`, {
                status: event.response.status,
              })
            })
          },
        }),
      ).effect(host)
      const context = {
        sessionID: Session.ID.make("ses_promise_session_http"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
      }

      const request = yield* hooks.trigger("session", "http.request", {
        ...context,
        request: new Request("https://provider.test", { method: "POST", body: "payload" }),
      })
      const ignored = yield* hooks.trigger("session", "http.request", {
        ...context,
        model: Model.Ref.make({ providerID: Provider.ID.make("other"), id: Model.ID.make("model") }),
        request: new Request("https://other.test"),
      })
      const response = yield* hooks.trigger("session", "http.response", {
        ...context,
        request: request.request,
        response: new Response(request.request.headers.get("x-hook") ?? "missing"),
      })

      expect(request.request.url).toBe("https://provider.test/changed")
      expect(ignored.request.url).toBe("https://other.test/")
      expect(yield* hooks.has("session", "http.request", Provider.ID.make("test"))).toBe(true)
      expect(yield* hooks.has("session", "http.request", Provider.ID.make("other"))).toBe(false)
      expect(yield* Effect.promise(() => response.response.text())).toBe("promise-response")
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

  it.effect("closes a pending event iterator with the plugin scope", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      let finalized = 0
      let iterator: AsyncIterator<unknown> | undefined
      let pending: Promise<IteratorResult<unknown>> | undefined
      const host = testHost({
        event: {
          subscribe: () =>
            Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
              Stream.flatMap(() => Stream.never),
              Stream.ensuring(Effect.sync(() => finalized++)),
            ),
        },
      })

      yield* Effect.scoped(
        PluginPromise.fromPromise(
          define({
            id: "promise-event-pending",
            setup: async (ctx) => {
              iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
              pending = iterator.next()
              await Effect.runPromise(Deferred.await(started))
            },
          }),
        ).effect(host),
      )

      expect(finalized).toBe(1)
      if (!pending || !iterator) yield* Effect.die("event iterator was not initialized")
      expect(yield* Effect.promise(() => pending)).toEqual({ done: true, value: undefined })
      expect(yield* Effect.promise(() => iterator.next())).toEqual({ done: true, value: undefined })
    }),
  )

  it.live("closes event iterators on break, completion, and failure", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const plugins = yield* Plugin.Service
      const closed: string[] = []
      const broke = yield* Deferred.make<void>()
      const promisePlugin = define({
        id: "promise-event-terminal",
        setup: async (ctx) => {
          void (async () => {
            for await (const _event of ctx.event.subscribe()) break
            await Effect.runPromise(Deferred.succeed(broke, undefined))
          })()
        },
      })

      yield* plugins.activate([{ ...PluginPromise.fromPromise(promisePlugin), version: "1" }])
      yield* Effect.sleep("10 millis")
      yield* bus.publish(ConfigSchema.Event.Updated, {})
      yield* Deferred.await(broke)

      yield* Effect.scoped(
        PluginPromise.fromPromise(
          define({
            id: "promise-event-complete",
            setup: async (ctx) => {
              const iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
              expect(await iterator.next()).toEqual({ done: true, value: undefined })
              expect(await iterator.next()).toEqual({ done: true, value: undefined })
            },
          }),
        ).effect(
          testHost({
            event: {
              subscribe: () => Stream.empty.pipe(Stream.ensuring(Effect.sync(() => closed.push("complete")))),
            },
          }),
        ),
      )

      yield* Effect.scoped(
        PluginPromise.fromPromise(
          define({
            id: "promise-event-failure",
            setup: async (ctx) => {
              const iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
              await expect(iterator.next()).rejects.toThrow("event failure")
              expect(await iterator.next()).toEqual({ done: true, value: undefined })
            },
          }),
        ).effect(
          testHost({
            event: {
              subscribe: () =>
                Stream.fail(new Error("event failure")).pipe(
                  Stream.ensuring(Effect.sync(() => closed.push("failure"))),
                ),
            },
          }),
        ),
      )

      expect(closed).toEqual(["complete", "failure"])
    }),
  )

  it.effect("closes every event iterator when the plugin scope closes", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      let started = 0
      let finalized = 0
      const host = testHost({
        event: {
          subscribe: () =>
            Stream.fromEffect(
              Effect.sync(() => ++started).pipe(
                Effect.tap((count) => (count === 3 ? Deferred.succeed(ready, undefined) : Effect.void)),
              ),
            ).pipe(
              Stream.flatMap(() => Stream.never),
              Stream.ensuring(Effect.sync(() => finalized++)),
            ),
        },
      })

      yield* Effect.scoped(
        PluginPromise.fromPromise(
          define({
            id: "promise-event-multiple",
            setup: async (ctx) => {
              const events = ctx.event.subscribe()
              void events[Symbol.asyncIterator]().next()
              void events[Symbol.asyncIterator]().next()
              void ctx.event.subscribe()[Symbol.asyncIterator]().next()
              await Effect.runPromise(Deferred.await(ready))
            },
          }),
        ).effect(host),
      )

      expect(finalized).toBe(3)
    }),
  )

  it.effect("closes a Promise event iterator when the plugin is replaced", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      let iterator: AsyncIterator<unknown> | undefined
      let pending: Promise<IteratorResult<unknown>> | undefined
      const previous = PluginPromise.fromPromise(
        define({
          id: "promise-event-replacement",
          setup: async (ctx) => {
            iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
            pending = iterator.next()
          },
        }),
      )

      yield* plugins.activate([{ ...previous, version: "1" }])
      yield* plugins.activate([{ id: previous.id, version: "2", effect: () => Effect.void }])

      if (!pending || !iterator) yield* Effect.die("event iterator was not initialized")
      expect(yield* Effect.promise(() => pending)).toEqual({ done: true, value: undefined })
      expect(yield* Effect.promise(() => iterator.next())).toEqual({ done: true, value: undefined })
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

  it.effect("returns content-only plugin results through Code Mode", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const registry = yield* Tool.Service
      const host = yield* PluginHost.make(plugins)
      const promisePlugin = define({
        id: "content-only-tool",
        setup: async (ctx) => {
          await ctx.tool.transform((tools) => {
            tools.add({
              name: "demo_status",
              description: "Returns a status string",
              input: Schema.Struct({}),
              execute: async () => ({ content: [{ type: "text", text: "hello" }] }),
              options: { codemode: true },
            })
          })
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)

      const toolSet = yield* registry.snapshot()
      const throughCodeMode = yield* toolSet.execute({
        sessionID: Session.ID.make("ses_content_only_tool"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_content_only_tool"),
        call: {
          type: "tool-call",
          id: "call_content_only_tool",
          name: "execute",
          input: { code: "return await tools.demo_status({})" },
        },
      })
      expect(throughCodeMode).toMatchObject({
        output: { output: "hello", toolCalls: [{ tool: "demo_status", status: "completed" }] },
        content: [{ type: "text", text: "hello" }],
      })
    }),
  )
})
