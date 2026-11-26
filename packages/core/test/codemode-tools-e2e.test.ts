import { describe, expect } from "bun:test"
import path from "path"
import { LanguageModel, ToolFailure } from "@opencode/ai/effect"
import type { LLMClientService } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Automation } from "@opencode/core/automation"
import { AutomationCode } from "@opencode/core/automation/code"
import { Bus } from "@opencode/core/bus"
import { CodeModeAgents } from "@opencode/core/codemode/agents"
import { CodeModeApi } from "@opencode/core/codemode/api"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeCustomTool } from "@opencode/core/codemode/custom-tool"
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
import { PermissionPolicy } from "@opencode/core/permission/policy"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { CodeModeAgentsPlugin } from "@opencode/core/tool/plugin/codemode-agents"
import { CodeModeToolsPlugin } from "@opencode/core/tool/plugin/codemode-tools"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Schema } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { registerToolPlugin } from "./lib/tool"

const e2e = testEffect(Layer.empty)

const demoPlugin = {
  id: "test.demo.tools",
  effect: Effect.fn("DemoTools")(function* (ctx: Parameters<typeof CodeModeToolsPlugin.Plugin.effect>[0]) {
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) => {
        editor.namespace({ name: "demo", description: "Demo tools for tests." })
        editor.add({
          name: "allowed",
          description: "Echo a label with a prefix.",
          input: Schema.Struct({ label: Schema.String }),
          output: Schema.Struct({ result: Schema.String }),
          options: { namespace: "demo", codemode: true },
          execute: (input) => Effect.succeed({ output: { result: `ok:${input.label}` } }),
        })
        editor.add({
          name: "secret",
          description: "Secret tool that must stay out of unscoped custom tools.",
          input: Schema.Struct({}),
          output: Schema.Struct({ secret: Schema.String }),
          options: { namespace: "demo", codemode: true },
          execute: () => Effect.succeed({ output: { secret: "top-secret" } }),
        })
        editor.add({
          name: "guarded",
          description: "Tool that checks permission before returning.",
          input: Schema.Struct({ item: Schema.String }),
          output: Schema.Struct({ ok: Schema.Boolean }),
          options: { namespace: "demo", codemode: true },
          execute: (input, context) =>
            permission
              .assert({
                action: "demo_guarded",
                resources: [input.item],
                ...Permission.invocation(context),
              })
              .pipe(
                Effect.as({ output: { ok: true } }),
                Effect.mapError((error) => new ToolFailure({ message: error.message, error })),
              ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

const pluginSupervisor = makeLocationNode({
  name: "test/codemode-tools-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(demoPlugin)
      yield* registerToolPlugin(CodeModeAgentsPlugin.Plugin, {
        session: { hook: (name, callback, options) => hooks.register("session", name, callback, options) },
      })
      yield* registerToolPlugin(CodeModeToolsPlugin.Plugin)
    }),
  ),
  deps: [
    Agent.node,
    Bus.node,
    CodeModeAgents.node,
    CodeModeApi.node,
    Config.node,
    Environment.node,
    FileAccess.node,
    FileMutation.node,
    FileWrite.node,
    Flag.node,
    FSUtil.node,
    Global.node,
    Job.node,
    Location.node,
    Model.node,
    Permission.node,
    PluginHooks.node,
    Session.node,
    Skill.node,
    SubagentJob.node,
    Tool.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
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

const harness = Effect.fnUntraced(function* (options?: {
  readonly experimental?: Record<string, boolean>
  readonly projectFiles?: Record<string, string>
  readonly userFiles?: Record<string, string>
  readonly permissions?: Permission.Ruleset
  readonly llmResponse?: TestLLM.Response
}) {
  const dir = yield* tmpdirScoped()
  const scope = yield* Effect.scope
  const globalCtx = yield* Layer.buildWithScope(tempGlobalLayer, scope)
  const global = Context.get(globalCtx, Global.Service)

  const experimental = options?.experimental ?? { codemode_tools: true, codemode_agents: true }
  yield* Effect.promise(() => Bun.write(path.join(dir.path, "opencode.json"), JSON.stringify({ experimental })))

  for (const [relative, content] of Object.entries(options?.projectFiles ?? {})) {
    const filepath = path.join(dir.path, ".opencode", relative)
    yield* Effect.promise(() => Bun.write(filepath, content))
  }
  for (const [relative, content] of Object.entries(options?.userFiles ?? {})) {
    const filepath = path.join(global.config, relative)
    yield* Effect.promise(() => Bun.write(filepath, content))
  }

  const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
  const llmContext = yield* Layer.buildWithScope(
    TestLLM.testLayer({ fallback: options?.llmResponse ?? TestLLM.text("fallback", "fallback") }),
    scope,
  )
  const context = yield* Layer.buildWithScope(
    AppNodeBuilder.build(nodes, [
      Database.node.replace(Database.configured({ path: ":memory:" })),
      Global.node.replace(Layer.succeedContext(globalCtx)),
      offlineModels,
      PluginSupervisor.node.replace(pluginSupervisor),
      LayerNodePlatform.llmClient.replace(Layer.succeedContext(llmContext as Context.Context<LLMClientService>)),
      SessionRunnerModel.node.replace(modelLayer),
    ]),
    scope,
  )

  const sessions = Context.get(context, Session.Service)
  const locations = Context.get(context, LocationServiceMap.Service)
  const locLayer = locations.get(location)
  const loc = yield* Layer.buildWithScope(locLayer, scope)
  const plugins = Context.get(loc, Plugin.Service)
  yield* plugins.awaitActivation
  const agents = Context.get(loc, Agent.Service)
  yield* agents.transform((editor) => {
    editor.update(Agent.ID.make("build"), (agent) => {
      agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
    })
  })
  const tools = Context.get(loc, Tool.Service)
  const permissions = Context.get(loc, Permission.Service)
  const session = yield* sessions.create({
    location,
    model: Model.Ref.make({ id: Model.ID.make("build"), providerID: Provider.ID.make("test") }),
    permissions: options?.permissions ?? [],
  })

  const execute = (code: string) =>
    Effect.gen(function* () {
      const selected = yield* agents.select(session.agent)
      const policy = PermissionPolicy.fromRules(selected.info?.permissions ?? [], session.permissions ?? [])
      const snapshot = yield* tools.snapshot(policy)
      return yield* snapshot.execute({
        sessionID: session.id,
        agent: selected.id,
        messageID: SessionMessage.ID.create(),
        call: { type: "tool-call", id: "call_exec", name: "execute", input: { code } },
      })
    }).pipe(Effect.provide(locLayer))

  return { dir, global, loc: locLayer, session, tools, agents, permissions, execute }
})

describe("CodeModeToolsPlugin", () => {
  e2e.live("stays hidden when codemode_tools flag is off", () =>
    Effect.gen(function* () {
      const env = yield* harness({
        experimental: { codemode_tools: false },
        projectFiles: {
          "tools/greet.js": CodeModeCustomTool.formatFile({
            description: "Greet someone",
            code: 'return "hi"',
          }),
        },
      })
      const registered = yield* env.tools.list()
      expect(registered.some((item) => item.options?.namespace === "opencode.tool")).toBe(false)
      expect(registered.some((item) => item.options?.namespace === "custom")).toBe(false)
    }),
  )

  e2e.live("loads project and user .js tools with project precedence and lazy-loaded catalog entries", () =>
    Effect.gen(function* () {
      const env = yield* harness({
        userFiles: {
          "tools/greet.js": CodeModeCustomTool.formatFile({
            description: "User greeting",
            input: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
            code: 'return "user:" + args.name',
          }),
          "tools/user_only.js": CodeModeCustomTool.formatFile({
            description: "Only in user config",
            code: 'return "from-user"',
          }),
        },
        projectFiles: {
          "tools/greet.js": CodeModeCustomTool.formatFile({
            description: "Project greeting",
            input: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
            code: 'return "project:" + args.name',
          }),
          "tools/github/triage.js": CodeModeCustomTool.formatFile({
            description: "Nested custom tool",
            input: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
            code: "return await tools.demo.allowed({ label: args.label })",
          }),
          "tools/broken.js": "not a valid header",
        },
      })

      const snapshot = yield* env.tools.snapshot()
      expect(snapshot.codeModeCatalog).toBeDefined()
      const summary = CodeModeCatalog.summarize(snapshot.codeModeCatalog!, { budget: Infinity })
      const customNamespace = summary.namespaces.find((item) => item.name === "custom")
      expect(customNamespace?.tools).toEqual(["custom.github.triage", "custom.greet", "custom.user_only"])

      // Saved tools are listed in full, so a later session sees what exists without searching.
      const registered = yield* env.tools.list()
      const greet = registered.find((item) => item.id === "custom_greet")
      const create = registered.find((item) => item.id === "opencode_tool_create")
      expect(greet?.options?.codemode).toEqual({ pinned: true })
      expect(create?.options?.codemode).toEqual({ pinned: true })

      const result = yield* env.execute(`
        const g = await tools.custom.greet({ name: "adam" })
        const u = await tools.custom.user_only({})
        const t = await tools.custom.github.triage({ label: "bug" })
        return { g, u, t }
      `)
      const value = result.output as { readonly output: string; readonly error?: true }
      expect(value.error).toBeUndefined()
      expect(JSON.parse(value.output)).toEqual({
        g: "project:adam",
        u: "from-user",
        t: { result: "ok:bug" },
      })
    }),
  )

  e2e.live("creates, inspects, lists, executes, updates, and deletes a custom tool live", () =>
    Effect.gen(function* () {
      const env = yield* harness()

      // Before any custom tool exists, the custom namespace is omitted from the catalog.
      const before = yield* env.tools.snapshot()
      expect(
        CodeModeCatalog.summarize(before.codeModeCatalog!, { budget: Infinity }).namespaces.some(
          (item) => item.name === "custom",
        ),
      ).toBe(false)

      // Create a custom tool in project scope.
      const created = yield* env.execute(`
        return await tools.opencode.tool.create({
          name: "format_label",
          description: "Format a label via demo.allowed",
          input: {
            type: "object",
            properties: { label: { type: "string" } },
            required: ["label"],
          },
          output: {
            type: "object",
            properties: { formatted: { type: "string" } },
            required: ["formatted"],
          },
          code: "const res = await tools.demo.allowed({ label: args.label }); return { formatted: res.result.toUpperCase() }",
        })
      `)
      const createdOutput = created.output as { readonly output: string; readonly error?: true }
      expect(createdOutput.error).toBeUndefined()
      const createdJson = JSON.parse(createdOutput.output)
      expect(createdJson).toMatchObject({
        name: "format_label",
        tool: "custom.format_label",
        scope: "project",
        created: true,
        usage: "await tools.custom.format_label({ label })",
      })
      expect(yield* Effect.promise(() => Bun.file(createdJson.filepath).exists())).toBe(true)

      // Immediately callable in the next execute turn, plus inspectable via get and list.
      const run = yield* env.execute(`
        const out = await tools.custom.format_label({ label: "v2" })
        const got = await tools.opencode.tool.get({ name: "custom.format_label" })
        const listed = await tools.opencode.tool.list({})
        return { out, gotName: got.name, listCount: listed.tools.length }
      `)
      const runOutput = run.output as { readonly output: string; readonly error?: true }
      expect(runOutput.error).toBeUndefined()
      expect(JSON.parse(runOutput.output)).toEqual({
        out: { formatted: "OK:V2" },
        gotName: "format_label",
        listCount: 1,
      })

      // Invalid args are rejected by Tool.Service against the tool's JSON Schema.
      const badArgs = yield* env.execute(`return await tools.custom.format_label({ label: 123 })`)
      expect((badArgs.output as { readonly error?: true; readonly output: string }).error).toBe(true)
      expect((badArgs.output as { readonly output: string }).output).toContain("Invalid arguments")

      // Updating the tool to return an invalid output trips runtime output validation.
      const updated = yield* env.execute(`
        return await tools.opencode.tool.create({
          name: "format_label",
          description: "Returns wrong shape",
          output: { type: "object", properties: { formatted: { type: "string" } }, required: ["formatted"] },
          code: "return { wrong: true }",
        })
      `)
      expect(JSON.parse((updated.output as { readonly output: string }).output).created).toBe(false)

      const badOutput = yield* env.execute(`return await tools.custom.format_label({})`)
      expect((badOutput.output as { readonly error?: true }).error).toBe(true)
      expect((badOutput.output as { readonly output: string }).output).toContain("does not match its schema")

      // Delete removes the file and unregisters the tool immediately.
      const deleted = yield* env.execute(`return await tools.opencode.tool.delete({ name: "format_label" })`)
      expect(JSON.parse((deleted.output as { readonly output: string }).output)).toMatchObject({
        name: "format_label",
        removed: true,
      })
      expect(yield* Effect.promise(() => Bun.file(createdJson.filepath).exists())).toBe(false)
      const after = yield* env.tools.list()
      expect(after.some((item) => item.id === "custom_format_label")).toBe(false)
    }),
  )

  e2e.live("limits blast radius to statically referenced tools and extensions and enforces inner permissions", () =>
    Effect.gen(function* () {
      const env = yield* harness({
        permissions: [
          { action: "edit", resource: "*", effect: "allow" },
          { action: "demo_secret", resource: "*", effect: "deny" },
          { action: "demo_guarded", resource: "blocked", effect: "deny" },
        ],
        projectFiles: {
          "tools/scoped.js": CodeModeCustomTool.formatFile({
            description: "Calls only demo.allowed and inspects its scoped catalog",
            code: `
              const allowed = await tools.demo.allowed({ label: "safe" })
              const visible = search({}).items.map((item) => item.path)
              return { allowed, visible }
            `,
          }),
          "tools/needs_secret.js": CodeModeCustomTool.formatFile({
            description: "Calls demo.secret which is wholly denied",
            code: "return await tools.demo.secret({})",
          }),
          "tools/needs_guard.js": CodeModeCustomTool.formatFile({
            description: "Calls demo.guarded with caller-supplied item",
            input: { type: "object", properties: { item: { type: "string" } }, required: ["item"] },
            code: "return await tools.demo.guarded({ item: args.item })",
          }),
        },
      })

      const scoped = yield* env.execute(`
        const out = await tools.custom.scoped({})
        const meta = await tools.opencode.tool.get({ name: "scoped" })
        return { out, tools: meta.tools, extensions: meta.extensions }
      `)
      const scopedOutput = scoped.output as { readonly output: string; readonly error?: true }
      if (scopedOutput.error) throw new Error(scopedOutput.output)
      expect(JSON.parse(scopedOutput.output)).toEqual({
        out: {
          allowed: { result: "ok:safe" },
          visible: ["tools.demo.allowed"],
        },
        tools: ["demo.allowed"],
        extensions: [],
      })

      // Whole-tool deny strips the tool from the custom tool's scoped inventory.
      const wholeDenied = yield* env.execute(`return await tools.custom.needs_secret({})`)
      expect((wholeDenied.output as { readonly error?: true }).error).toBe(true)
      expect((wholeDenied.output as { readonly output: string }).output).toContain("Unknown tool 'demo.secret'")

      // Resource-scoped deny lets allowed resources succeed and blocks denied resources at the leaf.
      const guardAllowed = yield* env.execute(`return await tools.custom.needs_guard({ item: "ok" })`)
      expect((guardAllowed.output as { readonly error?: true }).error).toBeUndefined()
      expect(JSON.parse((guardAllowed.output as { readonly output: string }).output)).toEqual({ ok: true })

      const guardDenied = yield* env.execute(`return await tools.custom.needs_guard({ item: "blocked" })`)
      expect((guardDenied.output as { readonly error?: true }).error).toBe(true)
      expect((guardDenied.output as { readonly output: string }).output).toContain("Permission")
    }),
  )

  e2e.live("runs llm() with structured schema inside a saved custom tool", () =>
    Effect.gen(function* () {
      const env = yield* harness({
        llmResponse: TestLLM.toolCall("tc_1", "respond", { verdict: "clean", score: 9 }),
        projectFiles: {
          "tools/classify.js": CodeModeCustomTool.formatFile({
            description: "Classify text using llm()",
            input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
            output: {
              type: "object",
              properties: { verdict: { type: "string" }, score: { type: "number" } },
              required: ["verdict", "score"],
            },
            code: `
              return await llm("Classify: " + args.text, {
                schema: {
                  type: "object",
                  properties: { verdict: { type: "string" }, score: { type: "number" } },
                  required: ["verdict", "score"],
                },
              })
            `,
          }),
        },
      })

      const result = yield* env.execute(`return await tools.custom.classify({ text: "hello" })`)
      const output = result.output as { readonly output: string; readonly error?: true }
      expect(output.error).toBeUndefined()
      expect(JSON.parse(output.output)).toEqual({ verdict: "clean", score: 9 })
    }),
  )

  e2e.live("create runs `test`, rejects Node globals, and an overwrite or hand edit runs as written", () =>
    Effect.gen(function* () {
      const env = yield* harness({ experimental: { codemode_tools: true, full_codemode: true } })
      const json = (result: { readonly output?: unknown }) => {
        const out = result.output as { readonly output: string; readonly error?: true }
        if (out.error) throw new Error(out.output)
        return JSON.parse(out.output)
      }

      const rejected = yield* env.execute(
        `return await tools.opencode.tool.create({ name: "cwd", description: "cwd", code: "return process.cwd()" })`,
      )
      const message = (rejected.output as { readonly output: string }).output
      expect(message).toContain("`process` does not exist")
      expect(message).toContain("Relative paths already resolve against the project directory")

      // One call saves the tool, runs it and returns its answer.
      const created = json(
        yield* env.execute(`
          return await tools.opencode.tool.create({
            name: "double",
            description: "Double a number.",
            input: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
            code: "return { value: args.n * 2 }",
            test: { n: 21 },
          })
        `),
      )
      expect(created.result).toEqual({ value: 42 })
      expect(created.usage).toBe("await tools.custom.double({ n })")

      const badTest = yield* env.execute(`
        return await tools.opencode.tool.create({
          name: "double",
          description: "Double a number.",
          input: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
          code: "return { value: args.missing.n }",
          test: { n: 1 },
        })
      `)
      expect((badTest.output as { readonly output: string }).output).toContain("Its test run failed")

      // Overwritten earlier in the same script: the call runs the new code, not what the script started with.
      const overwritten = json(
        yield* env.execute(`
          await tools.opencode.tool.create({
            name: "double",
            description: "Double a number.",
            input: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
            code: "return { value: args.n * 2, version: 2 }",
          })
          return await tools.custom.double({ n: 2 })
        `),
      )
      expect(overwritten).toEqual({ value: 4, version: 2 })

      // Edited by hand, with no reload in between.
      const file = path.join(env.dir.path, ".opencode", "tools", "double.js")
      const source = yield* Effect.promise(() => Bun.file(file).text())
      yield* Effect.promise(() => Bun.write(file, source.replace("version: 2", "version: 3")))
      expect(json(yield* env.execute(`return await tools.custom.double({ n: 2 })`))).toEqual({ value: 4, version: 3 })
    }),
  )

  e2e.live("lists a namespace in one search page", () =>
    Effect.gen(function* () {
      const env = yield* harness({
        projectFiles: Object.fromEntries(
          Array.from({ length: 14 }, (_, index) => [
            `tools/report_${String(index).padStart(2, "0")}.js`,
            CodeModeCustomTool.formatFile({ description: `Report ${index}`, code: "return 1" }),
          ]),
        ),
      })
      const result = yield* env.execute(`const found = search({ namespace: "custom" }); return { count: found.items.length, remaining: found.remaining }`)
      expect(JSON.parse((result.output as { readonly output: string }).output)).toEqual({ count: 14, remaining: 0 })
    }),
  )

  e2e.live("caps recursive custom tool calls at MAX_DEPTH", () =>
    Effect.gen(function* () {
      const env = yield* harness({
        projectFiles: {
          "tools/loop_a.js": CodeModeCustomTool.formatFile({
            description: "Calls loop_b",
            code: "return await tools.custom.loop_b({})",
          }),
          "tools/loop_b.js": CodeModeCustomTool.formatFile({
            description: "Calls loop_a",
            code: "return await tools.custom.loop_a({})",
          }),
        },
      })

      const result = yield* env.execute(`return await tools.custom.loop_a({})`)
      const output = result.output as { readonly output: string; readonly error?: true }
      expect(output.error).toBe(true)
      expect(output.output).toContain(`Custom tool call depth exceeded limit (${CodeModeCustomTool.MAX_DEPTH})`)
      expect(output.output).toContain("custom.loop_a -> custom.loop_b")
    }),
  )

  e2e.live("saves user-scoped custom tools under global config and enforces external_directory permission", () =>
    Effect.gen(function* () {
      const denied = yield* harness({
        permissions: [
          { action: "edit", resource: "*", effect: "allow" },
          { action: "external_directory", resource: "*", effect: "deny" },
        ],
      })
      const blocked = yield* denied.execute(`
        return await tools.opencode.tool.create({
          name: "user_tool",
          scope: "user",
          description: "Should be denied without external_directory",
          code: "return 1",
        })
      `)
      expect((blocked.output as { readonly error?: true }).error).toBe(true)

      const allowed = yield* harness()
      const created = yield* allowed.execute(`
        return await tools.opencode.tool.create({
          name: "user_tool",
          scope: "user",
          description: "User-scoped tool",
          code: "return 42",
        })
      `)
      const createdJson = JSON.parse((created.output as { readonly output: string }).output)
      expect(createdJson.scope).toBe("user")
      expect(createdJson.filepath).toBe(path.join(allowed.global.config, "tools", "user_tool.js"))
      const run = yield* allowed.execute(`return await tools.custom.user_tool({})`)
      expect(JSON.parse((run.output as { readonly output: string }).output)).toBe(42)
    }),
  )

  e2e.live("blocks opencode.tool.create/delete and custom.* inside unattended automations", () =>
    Effect.gen(function* () {
      const env = yield* harness({
        projectFiles: {
          "tools/hello.js": CodeModeCustomTool.formatFile({
            description: "Hello",
            code: 'return "hello"',
          }),
        },
      })

      for (const code of [
        'await tools.opencode.tool.create({ name: "x", description: "x", code: "return 1" })',
        'await tools.opencode.tool.delete({ name: "hello" })',
        "await tools.custom.hello({})",
      ]) {
        const result = yield* AutomationCode.run(
          env.session,
          { type: "code", code },
          {
            automationID: Automation.ID.make("aut_test"),
            messageID: SessionMessage.ID.create(),
            state: null,
            now: 0,
            runs: 0,
          },
        ).pipe(Effect.provide(env.loc))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain("cannot be used inside an automation")
      }
    }),
  )
})
