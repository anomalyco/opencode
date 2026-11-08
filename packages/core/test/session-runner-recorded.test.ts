import { HttpRecorder } from "@Mackery6969/http-recorder"
import { OpenAIChat } from "@Mackery6969/ai/protocols/openai-chat"
import { Auth, LLMClient, type LLMClientService, RequestExecutor } from "@Mackery6969/ai/route"
import { Model } from "@Mackery6969/core/model"
import { Database } from "@Mackery6969/core/database/database"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { LayerNodePlatform } from "@Mackery6969/core/effect/app-node-platform"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { Bus } from "@Mackery6969/core/bus"
import { EventTable } from "@Mackery6969/core/event/sql"
import { Permission } from "@Mackery6969/core/permission"
import { Agent } from "@Mackery6969/core/agent"
import { Config } from "@Mackery6969/core/config"
import { Project } from "@Mackery6969/core/project"
import { ProjectTable } from "@Mackery6969/core/project/sql"
import { AbsolutePath } from "@Mackery6969/core/schema"
import { Session } from "@Mackery6969/core/session"
import { Snapshot } from "@Mackery6969/core/snapshot"
import { SessionProjector } from "@Mackery6969/core/session/projector"
import { SessionExecution } from "@Mackery6969/core/session/execution"
import { SessionRunCoordinator } from "@Mackery6969/core/session/run-coordinator"
import { SessionRunner } from "@Mackery6969/core/session/runner/index"
import { SessionRunnerLLM } from "@Mackery6969/core/session/runner/llm"
import { SessionRunnerModel } from "@Mackery6969/core/session/runner/model"
import { Tool } from "@Mackery6969/core/tool"
import { SessionTable } from "@Mackery6969/core/session/sql"
import { SessionStore } from "@Mackery6969/core/session/store"
import { Location } from "@Mackery6969/core/location"
import { InstructionBuiltIns } from "@Mackery6969/core/instructions/builtins"
import { InstructionDiscovery } from "@Mackery6969/core/instruction-discovery"
import { Instructions } from "@Mackery6969/core/instructions/index"
import { SkillInstructions } from "@Mackery6969/core/skill/instructions"
import { ReferenceInstructions } from "@Mackery6969/core/reference/instructions"
import { McpInstructions } from "@Mackery6969/core/mcp/instructions"
import { PluginSupervisor } from "@Mackery6969/core/plugin/supervisor"
import { Plugin } from "@Mackery6969/core/plugin"
import { PluginHooks } from "@Mackery6969/core/plugin/hooks"
import { OptimizePlugin } from "@Mackery6969/core/plugin/optimize"
import { IdentityPlugin } from "@Mackery6969/core/plugin/identity"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Tracer } from "effect"
import path from "node:path"
import { testEffect } from "./lib/effect"
import { LocationServiceMap } from "@Mackery6969/core/location-service-map"
import { promptLocationNode } from "./fixture/prompt-location"
import { permissionLayer } from "./lib/permission"
import { agentHost, modelHost, host, noProviders } from "./plugin/host"

const cassetteName = "session-runner/openai-chat-streams-text"
const cassetteDirectory = path.resolve(import.meta.dir, "fixtures/recordings")
if (process.env.RECORD === "true") {
  if (process.env.CI !== undefined) throw new Error("Unset CI before recording HTTP cassettes")
  HttpRecorder.removeCassetteSync(cassetteName, { directory: cassetteDirectory })
}
const cassette = HttpRecorder.layerFetch(cassetteName, { directory: cassetteDirectory })
const executor = RequestExecutor.layer.pipe(Layer.provide(cassette))
const client = LLMClient.layer.pipe(Layer.provide(executor))
const permission = permissionLayer()
const model = OpenAIChat.route
  .with({
    endpoint: { baseURL: "https://api.openai.com/v1" },
    auth: Auth.bearer(process.env.OPENAI_API_KEY ?? "fixture"),
    maxTokens: 20,
    temperature: 0,
  })
  .model({ id: "gpt-4o-mini", capabilities: { promptCacheKey: true } })
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () =>
    Effect.succeed(
      SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [],
        limit: { context: 200_000, output: 20 },
      }),
    ),
})
const systemContext = Layer.mock(InstructionBuiltIns.Service, { load: () => Effect.succeed(Instructions.empty) })
const instructionContext = Layer.mock(InstructionDiscovery.Service, {
  project: true,
  global: true,
  load: () => Effect.succeed(Instructions.empty),
})
const skillInstructions = Layer.mock(SkillInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const referenceInstructions = Layer.mock(ReferenceInstructions.Service, {
  load: () => Effect.succeed(Instructions.empty),
})
const mcpInstructions = Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const config = Config.testLayer()
const promptModels = Layer.mock(Model.Service, {
  get: () => Effect.undefined,
  all: () => Effect.succeed([]),
  available: () => Effect.succeed([]),
  default: () => Effect.undefined,
  small: () => Effect.undefined,
})
const runnerLayer = (llmClient: Layer.Layer<LLMClientService>) =>
  AppNodeBuilder.build(SessionRunnerLLM.node, [
    Snapshot.node.replace(Snapshot.noopLayer),
    LayerNodePlatform.llmClient.replace(llmClient),
    SessionRunnerModel.node.replace(models),
    InstructionBuiltIns.node.replace(systemContext),
    InstructionDiscovery.node.replace(instructionContext),
    Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    SkillInstructions.node.replace(skillInstructions),
    ReferenceInstructions.node.replace(referenceInstructions),
    McpInstructions.node.replace(mcpInstructions),
    Config.node.replace(config),
    Permission.node.replace(permission),
    PluginSupervisor.node.replace(Layer.empty),
    Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
  ])
const execution = (llmClient: Layer.Layer<LLMClientService>) =>
  Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const sessionRunner = yield* SessionRunner.Service
      const coordinator = yield* SessionRunCoordinator.make<Session.ID, SessionRunner.RunError>({
        drain: (sessionID, force) => sessionRunner.drain({ sessionID, force }).pipe(Effect.asVoid),
      })
      return SessionExecution.Service.of({
        active: coordinator.active,
        isActive: coordinator.isActive,
        resume: coordinator.run,
        wake: coordinator.wake,
        interrupt: (sessionID) => coordinator.interrupt(sessionID),
        awaitIdle: coordinator.awaitIdle,
      })
    }),
  ).pipe(Layer.provide(runnerLayer(llmClient)), Layer.orDie)
const testLayer = (llmClient: Layer.Layer<LLMClientService>) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      Model.node,
      PluginHooks.node,
      Tool.node,
      SessionRunnerModel.node,
      InstructionBuiltIns.node,
      InstructionDiscovery.node,
      SkillInstructions.node,
      ReferenceInstructions.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      Session.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      LocationServiceMap.node.replace(promptLocationNode),
      LayerNodePlatform.llmClient.replace(llmClient),
      Permission.node.replace(permission),
      Model.node.replace(promptModels),
      SessionRunnerModel.node.replace(models),
      InstructionBuiltIns.node.replace(systemContext),
      InstructionDiscovery.node.replace(instructionContext),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      SkillInstructions.node.replace(skillInstructions),
      ReferenceInstructions.node.replace(referenceInstructions),
      Config.node.replace(config),
      Snapshot.node.replace(Snapshot.noopLayer),
      PluginSupervisor.node.replace(Layer.empty),
      Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
      SessionExecution.node.replace(execution(llmClient)),
    ],
  )
const spans: Tracer.NativeSpan[] = []
const tracer = Tracer.make({
  span(options) {
    const span = new Tracer.NativeSpan(options)
    spans.push(span)
    return span
  },
})
const it = testEffect(testLayer(client).pipe(Layer.provide(Layer.succeed(Tracer.Tracer, tracer))))
const sessionID = Session.ID.make("ses_runner_recorded")

describe("SessionRunnerLLM recorded", () => {
  it.effect("executes one recorded prompt through the recorded HTTP transport", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const models = yield* Model.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "execute", resource: "*", effect: "deny" })
        }),
      )
      const pluginHost = host({
        agent: agentHost(agents),
        model: modelHost(models),
        provider: noProviders,
        session: { hook: (name, callback) => hooks.register("session", name, callback) },
      })
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      yield* IdentityPlugin.Plugin.effect(pluginHost)
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const session = yield* Session.Service
      const prompt = yield* session.prompt({
        sessionID,
        text: "Say hello in one short sentence.",
        resume: false,
      })

      yield* session.resume(sessionID)

      const messages = yield* session.context(sessionID)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ id: prompt.id, type: "user", text: "Say hello in one short sentence." })
      expect(messages[1]).toMatchObject({ type: "assistant", agent: "build", finish: "stop" })
      expect(messages[1]?.type === "assistant" ? messages[1].content : []).toMatchObject([
        { type: "text", text: "Hello!" },
      ])
      expect(
        (yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .orderBy(EventTable.seq)
          .all()).map((event) => event.type),
      ).toEqual([
        "session.inbox.enqueued.1",
        "session.instructions.updated.2",
        "session.inbox.delivered.1",
        "session.step.started.1",
        "session.text.started.1",
        "session.text.ended.1",
        "session.step.streamed.1",
        "session.step.ended.1",
      ])

      // The turn is its own trace, every span in it names the session, and the attempt names the model and tokens.
      const drain = spans.find((span) => span.name === "SessionRunner.drain")
      expect(drain).toBeDefined()
      expect(Option.isNone(drain!.parent)).toBe(true)
      const turn = spans.filter((span) => span.traceId === drain!.traceId)
      expect(turn.filter((span) => span.attributes.get("session.id") !== sessionID).map((span) => span.name)).toEqual(
        [],
      )
      const attempt = turn.find((span) => span.name === "SessionStep.attempt")
      expect(Object.fromEntries(attempt?.attributes ?? [])).toMatchObject({
        "gen_ai.provider.name": "openai",
        "gen_ai.request.model": "gpt-4o-mini",
        "gen_ai.response.finish_reasons": ["stop"],
        "gen_ai.usage.input_tokens": 465,
        "gen_ai.usage.output_tokens": 2,
        "opencode.usage.cost_usd": 0,
      })
      expect(attempt?.attributes.get("opencode.llm.first_output_ms")).toBeNumber()
    }).pipe(Effect.withSpan("fixture.request")),
  )
})
