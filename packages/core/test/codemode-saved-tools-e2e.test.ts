import { describe, expect } from "bun:test"
import path from "path"
import { LanguageModel } from "@opencode/ai/effect"
import type { LLMClientService, LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { CodeModeSavedTools } from "@opencode/core/codemode/saved-tools"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { SavedToolsPlugin } from "@opencode/core/tool/plugin/saved-tools"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { registerToolPlugin } from "./lib/tool"

const e2e = testEffect(Layer.empty)

const pluginSupervisor = makeLocationNode({
  name: "test/codemode-saved-tools-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      // A built-in tool under the saved tools' namespace, which a saved tool may not replace.
      yield* tools.transform((editor) => {
        editor.add({
          name: "builtin",
          description: "A built-in tool.",
          input: { type: "object" },
          options: { namespace: CodeModeSavedTools.NAMESPACE },
          execute: () => Effect.succeed({ content: "built-in" }),
        })
        editor.add({
          name: "move",
          description: "A built-in tool under a namespace of its own.",
          input: { type: "object" },
          options: { namespace: `${CodeModeSavedTools.NAMESPACE}.session` },
          execute: () => Effect.succeed({ content: "moved" }),
        })
      })
      yield* registerToolPlugin(SavedToolsPlugin.Plugin)
    }),
  ),
  deps: [
    Agent.node,
    CodeModeSavedTools.node,
    CodeModeSavedTools.storeNode,
    Config.node,
    Environment.node,
    FileAccess.node,
    FileMutation.node,
    FileWrite.node,
    Flag.node,
    Location.node,
    Permission.node,
    PluginHooks.node,
    Session.node,
    Tool.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  SessionRestart.node,
  LocationServiceMap.node,
  SessionStore.node,
  KV.node,
])

const modelLayer = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({
    select: (session) => Effect.fail(new SessionRunnerModel.ModelNotSelectedError({ sessionID: session.id })),
    resolve: (_session, _available, request) =>
      Effect.succeed(
        SessionRunnerModel.resolved(
          LanguageModel.make({ id: request.agent, provider: "test", route: OpenAIChat.route }),
          {
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            cost: [],
            limit: { context: 200_000, output: 32_000 },
          },
        ),
      ),
  }),
)

const harness = Effect.fnUntraced(function* (options: { enabled?: boolean; deny?: ReadonlyArray<string> } = {}) {
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      path.join(dir.path, "opencode.json"),
      JSON.stringify({ experimental: { codemode_tools: options.enabled ?? true } }),
    ),
  )
  const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
  const scope = yield* Effect.scope
  const global = yield* Layer.buildWithScope(tempGlobalLayer, scope)
  const llmContext = yield* Layer.buildWithScope(
    TestLLM.testLayer({ fallback: TestLLM.text("fallback", "fallback") }),
    scope,
  )
  const context = yield* Layer.buildWithScope(
    AppNodeBuilder.build(nodes, [
      Database.node.replace(Database.configured({ path: ":memory:" })),
      Global.node.replace(Layer.succeedContext(global)),
      // codemode_tools only turns on in local and dev builds.
      App.node.replace(Layer.succeed(App.Service, App.make({ name: "test", version: "test", channel: "local" }))),
      offlineModels,
      PluginSupervisor.node.replace(pluginSupervisor),
      LayerNodePlatform.llmClient.replace(Layer.succeedContext(llmContext as Context.Context<LLMClientService>)),
      SessionRunnerModel.node.replace(modelLayer),
    ]),
    scope,
  )
  const locations = Context.get(context, LocationServiceMap.Service)
  yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))
  yield* Agent.Service.use((agents) =>
    agents.transform((editor) => {
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
        for (const action of options.deny ?? []) agent.permissions.push({ action, resource: "*", effect: "deny" })
      })
    }),
  ).pipe(Effect.provide(locations.get(location)))
  const sessions = Context.get(context, Session.Service)
  const parent = yield* sessions.create({
    location,
    model: Model.Ref.make({ id: Model.ID.make("build"), providerID: Provider.ID.make("test") }),
  })
  const llm = Context.get(llmContext, TestLLM.Test)
  let calls = 0
  // Runs `code` as one execute call and returns its output as the model reads it.
  const run = (code: string) =>
    Effect.gen(function* () {
      const id = `call-execute-${calls++}`
      yield* llm.serve(
        (() => {
          const queue = [TestLLM.toolCall(id, "execute", { code }), TestLLM.text("done", "done")]
          return () => queue.shift() ?? TestLLM.text("unexpected", "unexpected")
        })(),
      )
      yield* sessions.prompt({ sessionID: parent.id, text: "Run the script" })
      yield* sessions.wait(parent.id)
      const part = (yield* sessions.context(parent.id))
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((item) => item.type === "tool" && item.id === id)
      if (part?.type !== "tool" || part.state.status !== "completed")
        throw new Error(`execute did not complete: ${JSON.stringify(part)}`)
      return part.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
    })
  return { run, llm }
})

const define = (spec: string) => `return await tool.define({ ${spec} })`

const add = define(`name: "add", description: "Adds two numbers.",
  input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  output: { type: "object", properties: { sum: { type: "number" } }, required: ["sum"] },
  run: \`async (input) => ({ sum: input.a + input.b })\``)

const text = (request: LLMRequest) => JSON.stringify(request)

describe("tool.define()", () => {
  e2e.live("saves a tool later scripts call under tools.opencode and see in the catalog", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      expect(yield* h.run(add)).toBe('{"path":"tools.opencode.add"}')
      expect(yield* h.run(`return await tools.opencode.add({ a: 2, b: 3 })`)).toBe('{"sum":5}')
      const requests = yield* h.llm.requests()
      expect(text(requests.at(-1)!)).toContain("Adds two numbers.")
      expect(text(requests[0]!)).toContain("tool.define(")
    }),
  )

  e2e.live("runs a saved tool that calls other tools, a saved one included", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* h.run(add)
      yield* h.run(
        define(`name: "double_sum", description: "Doubles a sum.", input: { type: "object" },
          run: \`async function (input) { const first = await tools.opencode.add(input); return (await tools.opencode.add({ a: first.sum, b: first.sum })).sum }\``),
      )
      expect(yield* h.run(`return await tools.opencode.double_sum({ a: 1, b: 2 })`)).toBe("6")
    }),
  )

  e2e.live("takes a method's source as run", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* h.run(
        define(
          `name: "hello", description: "Greets.", input: { type: "object" }, run: \`async run(input) { return "hi " + input.who }\``,
        ),
      )
      expect(yield* h.run(`return await tools.opencode.hello({ who: "there" })`)).toBe("hi there")
    }),
  )

  e2e.live("replaces a tool defined again under the same name, and deletes it", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* h.run(add)
      yield* h.run(
        define(`name: "add", description: "Adds, badly.", input: { type: "object" }, run: \`async () => 0\``),
      )
      expect(yield* h.run(`return await tools.opencode.add({ a: 2, b: 3 })`)).toBe("0")
      expect(yield* h.run(`return await tool.delete("add")`)).toBe('{"deleted":true}')
      expect(yield* h.run(`return await tool.delete("add")`)).toBe('{"deleted":false}')
      expect(yield* h.run(`return await tools.opencode.add({ a: 2, b: 3 })`)).toContain("add")
    }),
  )

  e2e.live("refuses a built-in tool's name, a schema that isn't one, and a run that isn't a function", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      expect(
        yield* h.run(define(`name: "builtin", description: "x", input: { type: "object" }, run: \`async () => 1\``)),
      ).toContain("built-in tool")
      expect(
        yield* h.run(define(`name: "a", description: "x", input: { type: "string" }, run: \`async () => 1\``)),
      ).toContain("input must be an object schema")
      expect(
        yield* h.run(define(`name: "a", description: "x", input: { type: "object" }, run: "not a function {"`)),
      ).toContain("run is not a function")
      expect(
        yield* h.run(define(`name: "Bad-Name", description: "x", input: { type: "object" }, run: \`async () => 1\``)),
      ).toContain("is invalid")
    }),
  )

  e2e.live("gives null for a run that returns nothing", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* h.run(
        define(`name: "noop", description: "Does nothing.", input: { type: "object" }, run: \`async () => {}\``),
      )
      expect(yield* h.run(`return await tools.opencode.noop({})`)).toBe("null")
    }),
  )

  e2e.live("runs under the caller's permissions", () =>
    Effect.gen(function* () {
      const h = yield* harness({ deny: ["opencode_builtin"] })
      yield* h.run(
        define(
          `name: "wrap", description: "Calls the built-in.", input: { type: "object" }, run: \`async () => await tools.opencode.builtin({})\``,
        ),
      )
      // A denied tool is left out of the saved tool's run, as it is from the caller's.
      expect(yield* h.run(`return await tools.opencode.wrap({})`)).toContain("Unknown tool 'opencode.builtin'")
    }),
  )

  e2e.live("refuses a name a built-in namespace uses", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      expect(
        yield* h.run(define(`name: "session", description: "x", input: { type: "object" }, run: \`async () => 1\``)),
      ).toContain("built-in tool")
    }),
  )

  e2e.live("hides a global tool behind the project's own, until that one is deleted", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* h.run(
        define(
          `name: "which", description: "x", input: { type: "object" }, global: true, run: \`async () => "global"\``,
        ),
      )
      yield* h.run(define(`name: "which", description: "x", input: { type: "object" }, run: \`async () => "project"\``))
      expect(yield* h.run(`return await tools.opencode.which({})`)).toBe("project")
      yield* h.run(`return await tool.delete("which")`)
      expect(yield* h.run(`return await tools.opencode.which({})`)).toBe("global")
    }),
  )

  e2e.live("is absent with the flag off", () =>
    Effect.gen(function* () {
      const h = yield* harness({ enabled: false })
      expect(yield* h.run(`return typeof tool`)).toBe("undefined")
      expect(text((yield* h.llm.requests())[0]!)).not.toContain("tool.define(")
    }),
  )

  e2e.live("stops saved tools that call each other too deep", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      yield* h.run(
        define(
          `name: "loop", description: "Calls itself.", input: { type: "object" }, run: \`async () => await tools.opencode.loop({})\``,
        ),
      )
      expect(yield* h.run(`return await tools.opencode.loop({})`)).toContain(
        `at most ${CodeModeSavedTools.MAX_DEPTH} deep`,
      )
    }),
  )
})

describe("CodeModeSavedTools.Store", () => {
  e2e.live("lists a project's tools with the global ones, its own winning a shared name", () =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const global = yield* Layer.buildWithScope(tempGlobalLayer, scope)
      const context = yield* Layer.buildWithScope(
        AppNodeBuilder.build(LayerNode.group([CodeModeSavedTools.storeNode]), [
          Database.node.replace(Database.configured({ path: ":memory:" })),
          Global.node.replace(Layer.succeedContext(global)),
        ]),
        scope,
      )
      const store = Context.get(context, CodeModeSavedTools.Store)
      const saved = (scope: string, name: string, description: string) =>
        store.save({ scope, name, description, input: { type: "object" }, code: "async () => 1" })
      yield* saved(CodeModeSavedTools.GLOBAL, "shared", "global")
      yield* saved(CodeModeSavedTools.GLOBAL, "everywhere", "global")
      yield* saved("project-a", "shared", "a")
      yield* saved("project-b", "only_b", "b")
      const list = (projectID: string) =>
        store
          .list(projectID)
          .pipe(Effect.map((tools) => tools.map((tool) => `${tool.name}:${tool.description}`).toSorted()))
      expect(yield* list("project-a")).toEqual(["everywhere:global", "shared:a"])
      expect(yield* list("project-b")).toEqual(["everywhere:global", "only_b:b", "shared:global"])
      // Deleting from a project removes its own copy first, which uncovers the global one.
      expect(yield* store.remove(["project-a", CodeModeSavedTools.GLOBAL], "shared")).toBe(true)
      expect(yield* list("project-a")).toEqual(["everywhere:global", "shared:global"])
    }),
  )
})
