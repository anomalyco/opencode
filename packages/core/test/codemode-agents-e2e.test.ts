import { describe, expect } from "bun:test"
import path from "path"
import { LanguageModel } from "@opencode/ai/effect"
import type { LLMClientService, LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { CodeModeAgents } from "@opencode/core/codemode/agents"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
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
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { CodeModeAgentsPlugin } from "@opencode/core/tool/plugin/codemode-agents"
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
  name: "test/codemode-agents-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(CodeModeAgentsPlugin.Plugin, {
        session: { hook: (name, callback, options) => hooks.register("session", name, callback, options) },
      })
    }),
  ),
  deps: [
    Agent.node,
    CodeModeAgents.node,
    Config.node,
    Environment.node,
    FileAccess.node,
    Flag.node,
    Job.node,
    Location.node,
    Model.node,
    Permission.node,
    PluginHooks.node,
    Session.node,
    Skill.node,
    Bus.node,
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
  SessionRestart.node,
  LocationServiceMap.node,
  SessionStore.node,
  KV.node,
])

// Each agent gets a model named after it, so a responder can answer the parent and its children apart.
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

type Response = ReturnType<typeof TestLLM.text>

const script = (responses: Record<string, ReadonlyArray<Response>>) => {
  const queues = new Map(Object.entries(responses).map(([agent, queue]) => [agent, [...queue]]))
  return (request: { readonly model: { readonly id: string } }) =>
    queues.get(request.model.id)?.shift() ?? TestLLM.text("unexpected request", "unexpected")
}

const harness = Effect.fnUntraced(function* () {
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(path.join(dir.path, "opencode.json"), JSON.stringify({ experimental: { codemode_agents: true } })),
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
      })
      editor.update(Agent.ID.make("reviewer"), (agent) => {
        agent.mode = "subagent"
        agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
      })
      editor.update(Agent.ID.make("readonly"), (agent) => {
        agent.mode = "subagent"
        agent.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })
    }),
  ).pipe(Effect.provide(locations.get(location)))
  const sessions = Context.get(context, Session.Service)
  const parent = yield* sessions.create({
    location,
    model: Model.Ref.make({ id: Model.ID.make("build"), providerID: Provider.ID.make("test") }),
  })
  const llm = Context.get(llmContext, TestLLM.Test)
  // Runs `code` as the parent's execute call and returns what the script returned, as the model reads it.
  const run = (code: string, responses: Record<string, ReadonlyArray<Response>>) =>
    Effect.gen(function* () {
      yield* llm.serve(
        script({
          ...responses,
          build: [
            TestLLM.toolCall("call-execute", "execute", { code }),
            ...(responses.build ?? []),
            TestLLM.text("done", "done"),
          ],
        }),
      )
      yield* sessions.prompt({ sessionID: parent.id, text: "Run the script" })
      yield* sessions.wait(parent.id)
      const part = (yield* sessions.context(parent.id))
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((item) => item.type === "tool" && item.id === "call-execute")
      if (part?.type !== "tool" || part.state.status !== "completed")
        throw new Error(`execute did not complete: ${JSON.stringify(part)}`)
      return part.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
    })
  const store = Context.get(context, SessionStore.Service)
  const restart = Context.get(context, SessionRestart.Service)
  return { sessions, parent, llm, run, store, restart }
})

const toolNames = (request: LLMRequest) => request.tools.map((tool) => tool.name)
const text = (request: LLMRequest) => JSON.stringify(request.messages)

describe("agent()", () => {
  e2e.live("returns the value a child recorded through structured_output, after it fixed what failed the schema", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const result = yield* h.run(
        `return await agent("Find bugs in src", { agent: "reviewer", label: "bug hunt", schema: { type: "object", properties: { bugs: { type: "array", items: { type: "string" } } }, required: ["bugs"], additionalProperties: false } })`,
        {
          reviewer: [
            TestLLM.toolCall("call-bad", "structured_output", { bugs: "off by one" }),
            TestLLM.toolCall("call-good", "structured_output", { bugs: ["off by one"] }),
            TestLLM.text("Recorded", "child-done"),
          ],
        },
      )
      expect(JSON.parse(result)).toEqual({ bugs: ["off by one"] })

      const requests = yield* h.llm.requests()
      const child = requests.filter((request) => request.model.id === "reviewer")
      // Accepted structured_output ends the child's turn immediately: no 3rd model step.
      expect(child).toHaveLength(2)
      expect(child[0]?.tools.find((tool) => tool.name === "structured_output")).toMatchObject({
        inputSchema: {
          type: "object",
          properties: { bugs: { type: "array", items: { type: "string" } } },
          required: ["bugs"],
          additionalProperties: false,
        },
      })
      expect(text(child[0]!)).toContain("Find bugs in src")
      expect(text(child[1]!)).toContain("does not match the required schema")
      // Only children with a schema see the tool.
      expect(requests.filter((request) => request.model.id === "build").flatMap(toolNames)).not.toContain(
        "structured_output",
      )
      const [session] = (yield* h.sessions.list({ parentID: h.parent.id })).data
      expect(session?.title).toBe("bug hunt")
    }),
  )

  e2e.live("lets a deny-by-default subagent (like explore) call structured_output", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const result = yield* h.run(
        `return await agent("Check auth", { agent: "readonly", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } })`,
        {
          readonly: [
            TestLLM.toolCall("call-ok", "structured_output", { ok: true }),
            TestLLM.text("Done", "readonly-done"),
          ],
        },
      )
      expect(JSON.parse(result)).toEqual({ ok: true })
      const child = (yield* h.llm.requests()).filter((request) => request.model.id === "readonly")
      expect(child).toHaveLength(1)
    }),
  )

  e2e.live("releases an orphaned agent() child on restart instead of reviving it", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const childID = Session.ID.create()
      yield* h.sessions.create({
        id: childID,
        parentID: h.parent.id,
        title: "orphan",
        agent: Agent.ID.make("reviewer"),
        metadata: { [CodeModeAgents.METADATA_KEY]: { childID, structured: false } },
      })
      yield* h.store.claim(childID)
      expect(yield* h.store.listSuspended()).toContain(childID)

      yield* h.restart.resumeSuspendedSessions
      expect(yield* h.store.listSuspended()).not.toContain(childID)
      expect(yield* h.llm.requests()).toHaveLength(0)
    }),
  )

  e2e.live("without a schema returns the child's final text; calls started together all finish", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const result = yield* h.run(
        `return await Promise.all([1, 2].map((n) => agent("Say hi " + n, { agent: "reviewer" })))`,
        {
          reviewer: [TestLLM.text("hi", "child-1"), TestLLM.text("hi", "child-2")],
        },
      )
      expect(JSON.parse(result)).toEqual(["hi", "hi"])
    }),
  )
})

describe("llm()", () => {
  e2e.live("asks again with the schema problems until the answer fits, with no session history", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const result = yield* h.run(
        `return await llm("Classify: the app crashes on save", { schema: { type: "object", properties: { kind: { enum: ["bug", "feature"] } }, required: ["kind"], additionalProperties: false } })`,
        {
          build: [
            TestLLM.toolCall("call-1", "respond", { kind: "crash" }),
            TestLLM.toolCall("call-2", "respond", { kind: "bug" }),
          ],
        },
      )
      expect(JSON.parse(result)).toEqual({ kind: "bug" })
      const calls = (yield* h.llm.requests()).filter((request) => toolNames(request).includes("respond"))
      expect(calls).toHaveLength(2)
      expect(calls[0]?.messages).toHaveLength(1)
      expect(text(calls[0]!)).not.toContain("Run the script")
      expect(text(calls[1]!)).toContain("did not match the required schema")
    }),
  )
})
