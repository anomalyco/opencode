import { describe, expect } from "bun:test"
import { Message, SystemPart } from "@opencode-ai/ai"
import { DateTime, Effect, Schema } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { Location } from "@opencode-ai/core/location"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { WebSearch } from "@opencode-ai/core/websearch"
import { Vcs } from "@opencode-ai/core/vcs"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { Tool } from "@opencode-ai/core/tool"
import { Provider } from "@opencode-ai/core/provider"
import { Project } from "@opencode-ai/core/project"
import { Workspace } from "@opencode-ai/core/workspace"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { define } from "@opencode-ai/plugin/promise/plugin"
import type { Info } from "@opencode-ai/plugin/promise/tool"
import { Money } from "@opencode-ai/schema/money"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { host as testHost } from "./host"

const it = testEffect(PluginTestLayer)

describe("fromPromise", () => {
  it.effect("exposes the host location including workspace and project metadata", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const location = yield* Location.Service
      const expected = new Location.Info({
        directory: AbsolutePath.make("/worktree/packages/app"),
        workspaceID: Workspace.ID.make("wrk_plugin_location"),
        project: {
          id: Project.ID.global,
          directory: AbsolutePath.make("/worktree"),
          canonical: AbsolutePath.make("/project"),
        },
      })
      const host = yield* PluginHost.make(plugins).pipe(
        Effect.provideService(Location.Service, {
          ...location,
          directory: expected.directory,
          workspaceID: expected.workspaceID,
          project: expected.project,
        }),
      )
      const seen: Location.Info[] = []
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-location",
          setup: (ctx) => {
            seen.push(ctx.location)
          },
        }),
      ).effect(host)

      expect(seen).toEqual([expected])
    }),
  )

  it.effect("adapts plugin storage methods", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const adapted = PluginPromise.fromPromise(
        define({
          id: "promise-storage",
          setup: async (ctx) => {
            expect(await ctx.storage.get("missing")).toBeUndefined()
            await ctx.storage.set("items/b", { order: 2 })
            await ctx.storage.set("items/a", { order: 1 })
            expect(await ctx.storage.get("items/a")).toEqual({ order: 1 })
            expect(await ctx.storage.scan({ prefix: "items/", limit: 1 })).toEqual({
              entries: [{ key: "items/a", value: { order: 1 } }],
              next: "items/a",
            })
            await ctx.storage.remove("items/a")
            await ctx.storage.remove("items/a")
            expect(await ctx.storage.get("items/a")).toBeUndefined()
          },
        }),
      )

      yield* plugins.activate([{ ...adapted, version: "1" }])
    }),
  )

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

  it.effect("preserves interrupt results and rejected Promise behavior", () =>
    Effect.gen(function* () {
      const seen: unknown[] = []
      const host = testHost({
        session: {
          interrupt: (input) => {
            if (input.sessionID === Session.ID.make("ses_failure")) {
              return Effect.fail(new Error("interrupt failed"))
            }
            expect(input.continue).toBe(true)
            return Effect.succeed({ interrupted: false })
          },
          switchAgent: (input) => Effect.sync(() => seen.push(input)),
          switchModel: (input) => Effect.sync(() => seen.push(input)),
          rename: (input) => Effect.sync(() => seen.push(input)),
          move: (input) => Effect.sync(() => seen.push(input)),
          wait: (input) => Effect.sync(() => seen.push(input)),
        },
      })

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-session-interrupt",
          setup: async (ctx) => {
            expect(await ctx.session.interrupt({ sessionID: "ses_success", continue: true })).toEqual({
              interrupted: false,
            })
            await expect(ctx.session.interrupt({ sessionID: "ses_failure" })).rejects.toThrow("interrupt failed")
            expect(await ctx.session.switchAgent({ sessionID: "ses_success", agent: "build" })).toBeUndefined()
            expect(
              await ctx.session.switchModel({
                sessionID: "ses_success",
                model: { providerID: "openai", id: "gpt-5" },
              }),
            ).toBeUndefined()
            expect(await ctx.session.rename({ sessionID: "ses_success", title: "Renamed" })).toBeUndefined()
            expect(
              await ctx.session.move({ sessionID: "ses_success", directory: "/destination", delivery: "queue" }),
            ).toBeUndefined()
            expect(await ctx.session.wait({ sessionID: "ses_success" })).toBeUndefined()
          },
        }),
      ).effect(host)

      expect(seen).toEqual([
        { sessionID: Session.ID.make("ses_success"), agent: Agent.ID.make("build") },
        {
          sessionID: Session.ID.make("ses_success"),
          model: { providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") },
        },
        { sessionID: Session.ID.make("ses_success"), title: "Renamed" },
        {
          sessionID: Session.ID.make("ses_success"),
          directory: AbsolutePath.make("/destination"),
          delivery: "queue",
        },
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
          expect(Object.keys(ctx.mcp).sort()).toEqual(["list", "reload", "transform"])
          const results = await Promise.all([
            ctx.agent.list(),
            ctx.catalog.provider.list(),
            ctx.catalog.model.list(),
            ctx.command.list(),
            ctx.integration.list(),
            ctx.mcp.list(),
            ctx.plugin.list(),
            ctx.reference.list(),
            ctx.skill.list(),
          ])
          seen.push(...results.map((result) => result.location.directory))
          expect((await ctx.integration.get({ integrationID: "missing" })).data).toBeNull()
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)

      expect(seen).toHaveLength(9)
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
              event.generation.temperature = 0.4
              event.providerOptions.reasoningEffort = "medium"
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
        generation: {},
        providerOptions: {},
      }

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual(["Initial", "Promise hook"])
      expect(event.tools).toEqual({})
      expect(event.generation).toEqual({ temperature: 0.4 })
      expect(event.providerOptions).toEqual({ reasoningEffort: "medium" })
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

  it.effect("registers a Promise VCS provider and forwards client reads", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const signals: AbortSignal[] = []
      const promisePlugin = define({
        id: "promise-vcs",
        setup: async (ctx) => {
          await ctx.vcs.transform((draft) => {
            draft.add({
              id: "custom",
              name: "Custom VCS",
              info: async (_input, request) => {
                signals.push(request.signal)
                return { branch: { current: "feature", default: "main" } }
              },
              branches: async (input, request) => {
                signals.push(request.signal)
                expect(input.search).toBe("feat")
                return ["feature"]
              },
              status: async (_input, request) => {
                signals.push(request.signal)
                return [{ file: "file.txt", additions: 1, deletions: 0, status: "added" }]
              },
              diff: async (input, request) => {
                signals.push(request.signal)
                expect(input.context).toBe(2)
                expect(input.maxOutputBytes).toBe(10_000_000)
                return [{ file: "file.txt", patch: "+hello", additions: 1, deletions: 0, status: "added" }]
              },
            })
            draft.default.set("custom")
          })

          expect((await ctx.vcs.get()).data.branch.current).toBe("feature")
          expect((await ctx.vcs.branches({ search: "feat" })).data).toEqual(["feature"])
          expect((await ctx.vcs.status()).data).toHaveLength(1)
          expect((await ctx.vcs.diff({ mode: "working", context: 2 })).data[0].patch).toBe("+hello")
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)
      expect((yield* vcs.info()).branch.current).toBe("feature")
      expect(signals).toHaveLength(4)
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBeTrue()
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
          await ctx.tool.hook("execute.before", (event) => {
            expect(event.tool).toBe("helllo")
            expect(event).not.toHaveProperty("inputSchema")
            event.tool = "hello"
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
          call: { type: "tool-call", id: "call_promise_tool", name: "helllo", input: { name: "world" } },
        }),
      ).toMatchObject({
        output: "Hello, world!",
        content: [{ type: "text", text: "Hello, world!" }],
      })
      expect(progress).toEqual([{ phase: "greeting" }])
    }),
  )

  it.live("adapts listed and retrieved tool executors without invoking them eagerly", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const host = yield* PluginHost.make(plugins)
      const calls: string[] = []
      const failure = new Tool.Error({ message: "executor failed" })
      yield* host.tool.transform((draft) => {
        draft.add({
          name: "hello",
          description: "Hello",
          options: { namespace: "acme", codemode: false },
          input: Schema.Struct({ name: Schema.String }),
          output: Schema.String,
          execute: ({ name }, context) => {
            calls.push(name)
            if (name === "failure") return Effect.fail(failure)
            return context.progress({ name }).pipe(Effect.as({ output: name }))
          },
        })
      })
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-tool-reads",
          setup: async (ctx) => {
            const tools: Info[] = []
            await ctx.tool.transform((draft) => {
              expect(draft.list().map((tool) => tool.id)).toEqual(["acme_hello"])
              tools.push(...draft.list())
              const tool = draft.get("acme_hello")
              if (!tool) throw new Error("Tool was not found")
              expect(tool.id).toBe("acme_hello")
              tools.push(tool)
            })
            expect(tools).toHaveLength(2)
            expect(calls).toEqual([])
            await Promise.all(
              tools.map(async (tool) => {
                const progress: Tool.Metadata[] = []
                const context = {
                  sessionID: Session.ID.make("ses_promise_tool_reads"),
                  agent: Agent.ID.make("build"),
                  messageID: SessionMessage.ID.make("msg_promise_tool_reads"),
                  id: Tool.CallID.make("call_reads"),
                  progress: async (update: Tool.Metadata) => {
                    progress.push(update)
                  },
                }
                expect(await tool.execute({ name: "world" }, context)).toEqual({ output: "world" })
                expect(progress).toEqual([{ name: "world" }])
                await expect(tool.execute({ name: "failure" }, context)).rejects.toBe(failure)
                const error = new Error("progress failed")
                await expect(
                  tool.execute(
                    { name: "world" },
                    {
                      ...context,
                      progress: async () => {
                        throw error
                      },
                    },
                  ),
                ).rejects.toBe(error)
              }),
            )
          },
        }),
      ).effect(host)
    }),
  )

  it.live("reloads and disposes Promise tools while preserving older snapshots", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const registry = yield* Tool.Service
      const host = yield* PluginHost.make(plugins)
      const source = { description: "Original", replays: 0 }
      const registrations: Array<{ reload: () => Promise<void>; dispose: () => Promise<void> }> = []
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-tool-lifecycle",
          setup: async (ctx) => {
            expect(Object.keys(ctx.tool).sort()).toEqual(["hook", "reload", "transform"])
            const registration = await ctx.tool.transform((draft) => {
              source.replays++
              const description = source.description
              draft.add({
                name: "reloadable",
                description,
                input: Schema.Struct({}),
                output: Schema.String,
                options: { codemode: false },
                execute: async () => ({ output: description }),
              })
              expect(draft.list().map((tool) => tool.id)).toEqual(["reloadable"])
              expect(draft.get("reloadable")?.id).toBe("reloadable")
              expect(draft.get("reloadable")?.name).toBe("reloadable")
              expect(draft.get("missing")).toBeUndefined()
            })
            registrations.push({ reload: ctx.tool.reload, dispose: registration.dispose })
          },
        }),
      ).effect(host)
      const registration = registrations[0]
      if (!registration) return yield* Effect.die("Promise tool registration was not captured")
      const original = yield* registry.snapshot()
      const execute = (snapshot: Tool.Snapshot) =>
        snapshot.execute({
          sessionID: Session.ID.make("ses_promise_tool_reload"),
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_promise_tool_reload"),
          call: { type: "tool-call", id: "call_promise_tool_reload", name: "reloadable", input: {} },
        })

      source.description = "Reloaded"
      yield* Effect.promise(() => registration.reload())
      const reloaded = yield* registry.snapshot()
      expect(source.replays).toBe(2)
      expect(reloaded.definitions).toContainEqual(
        expect.objectContaining({ name: "reloadable", description: "Reloaded" }),
      )
      expect(yield* execute(reloaded)).toMatchObject({ output: "Reloaded" })
      expect(yield* execute(original)).toMatchObject({ output: "Original" })

      yield* Effect.promise(() => registration.dispose())
      yield* Effect.promise(() => registration.dispose())
      expect((yield* registry.snapshot()).definitions.some((tool) => tool.name === "reloadable")).toBe(false)
      expect(yield* execute(original)).toMatchObject({ output: "Original" })
      expect(yield* execute(reloaded)).toMatchObject({ output: "Reloaded" })
      yield* Effect.promise(() => registration.reload())
      expect(source.replays).toBe(2)
      expect((yield* registry.snapshot()).definitions.some((tool) => tool.name === "reloadable")).toBe(false)
    }),
  )

  it.live("adapts tool updates, executor wrapping, and removal across replay and disposal", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const registry = yield* Tool.Service
      const host = yield* PluginHost.make(plugins)
      const progress: Tool.Metadata[] = []
      let greeting = "Hello"
      const registrations: Array<{ dispose: () => Promise<void> }> = []
      yield* host.tool.transform((draft) => {
        const text = greeting
        draft.add({
          name: "hello",
          description: "Hello",
          options: { namespace: "acme", codemode: false },
          input: Schema.Struct({ name: Schema.String }),
          output: Schema.String,
          execute: ({ name }, context) =>
            context.progress({ phase: "original" }).pipe(Effect.as({ output: `${text}, ${name}!` })),
        })
        draft.add({
          name: "temporary",
          description: "Temporary",
          input: Schema.Struct({}),
          options: { codemode: false },
          execute: () => Effect.succeed({ content: "temporary" }),
        })
      })
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-tool-mutations",
          setup: async (ctx) => {
            registrations.push(
              await ctx.tool.transform((draft) => {
                draft.update("missing", () => {
                  throw new Error("must not create a tool")
                })
                draft.update("acme_hello", (tool) => {
                  const execute = tool.execute
                  tool.description = "Wrapped"
                  delete tool.output
                  tool.execute = async (input, context) => {
                    const result = await execute(input, context)
                    return { content: `${result.output} Wrapped.` }
                  }
                })
                draft.remove("temporary")
              }),
            )
            greeting = "Hi"
            await ctx.tool.reload()
          },
        }),
      ).effect(host)
      const snapshot = yield* registry.snapshot()
      expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["acme_hello", "execute"])
      expect(snapshot.definitions[0]?.description).toBe("Wrapped")
      expect(snapshot.definitions[0]?.outputSchema).toBeUndefined()
      expect(
        yield* snapshot.execute({
          sessionID: Session.ID.make("ses_promise_tool_update"),
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_promise_tool_update"),
          call: { type: "tool-call", id: "call_update", name: "acme_hello", input: { name: "world" } },
          progress: (update) =>
            Effect.sync(() => {
              progress.push(update)
            }),
        }),
      ).toMatchObject({ content: [{ type: "text", text: "Hi, world! Wrapped." }] })
      expect(progress).toEqual([{ phase: "original" }])
      const registration = registrations[0]
      if (!registration) return yield* Effect.die("Promise tool registration was not captured")
      yield* Effect.promise(() => registration.dispose())
      yield* Effect.promise(() => registration.dispose())
      const restored = yield* registry.snapshot()
      expect(restored.definitions.map((tool) => tool.name)).toEqual(["acme_hello", "temporary", "execute"])
      expect(restored.definitions[0]?.description).toBe("Hello")
    }),
  )

  it.live("clears deleted tool options while retaining the namespace", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const registry = yield* Tool.Service
      const host = yield* PluginHost.make(plugins)
      yield* host.tool.transform((draft) => {
        draft.add({
          name: "hello",
          description: "Hello",
          options: { namespace: "acme", codemode: false },
          input: Schema.Struct({}),
          output: Schema.String,
          execute: () => Effect.succeed({ output: "Hello" }),
        })
      })
      const original = yield* registry.snapshot()
      expect(original.definitions.map((tool) => tool.name)).toEqual(["acme_hello", "execute"])
      expect(original.codeModeCatalog).toEqual([])

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-tool-options",
          setup: async (ctx) => {
            await ctx.tool.transform((draft) => {
              draft.update("acme_hello", (tool) => {
                delete tool.options
              })
              expect(draft.get("acme_hello")?.options).toEqual({ namespace: "acme" })
            })
          },
        }),
      ).effect(host)

      const snapshot = yield* registry.snapshot()
      expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
      expect(snapshot.codeModeCatalog?.map((tool) => tool.path)).toEqual(["acme.hello"])
      expect(original.definitions.map((tool) => tool.name)).toEqual(["acme_hello", "execute"])
      expect(
        yield* snapshot.execute({
          sessionID: Session.ID.make("ses_promise_tool_options"),
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_promise_tool_options"),
          call: {
            type: "tool-call",
            id: "call_options",
            name: "execute",
            input: { code: "return await tools.acme.hello({})" },
          },
        }),
      ).toMatchObject({
        output: { output: "Hello", toolCalls: [{ tool: "acme.hello", status: "completed" }] },
      })
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
