import { HttpRecorder } from "@opencode-ai/http-recorder"
import { OpenAIChat } from "@opencode-ai/ai/protocols/openai-chat"
import { Auth, LLMClient, type LLMClientService, RequestExecutor } from "@opencode-ai/ai/route"
import { Catalog } from "@opencode-ai/core/catalog"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Permission } from "@opencode-ai/core/permission"
import { Agent } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner/index"
import { SessionRunnerLLM } from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { Tool } from "@opencode-ai/core/tool"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Location } from "@opencode-ai/core/location"
import { InstructionBuiltIns } from "@opencode-ai/core/instructions/builtins"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { Instructions } from "@opencode-ai/core/instructions/index"
import { SkillInstructions } from "@opencode-ai/core/skill/instructions"
import { ReferenceInstructions } from "@opencode-ai/core/reference/instructions"
import { McpInstructions } from "@opencode-ai/core/mcp/instructions"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { SystemPromptPlugin } from "@opencode-ai/core/plugin/system-prompt"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import path from "node:path"
import { testEffect } from "./lib/effect"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { promptLocationNode } from "./fixture/prompt-location"
import { permissionLayer } from "./lib/permission"
import { agentHost, catalogHost, host } from "./plugin/host"

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
    generation: { maxTokens: 20, temperature: 0 },
  })
  .model({ id: "gpt-4o-mini" })
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
const pluginSupervisor = Layer.succeed(PluginSupervisor.Service, PluginSupervisor.Service.of({ flush: Effect.void }))
const promptCatalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.undefined,
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
  },
  model: {
    get: () => Effect.undefined,
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
    default: () => Effect.undefined,
    small: () => Effect.undefined,
  },
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
    PluginSupervisor.node.replace(pluginSupervisor),
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
  ).pipe(Layer.provide(runnerLayer(llmClient)))
const testLayer = (llmClient: Layer.Layer<LLMClientService>) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      Catalog.node,
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
      Catalog.node.replace(promptCatalog),
      SessionRunnerModel.node.replace(models),
      InstructionBuiltIns.node.replace(systemContext),
      InstructionDiscovery.node.replace(instructionContext),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      SkillInstructions.node.replace(skillInstructions),
      ReferenceInstructions.node.replace(referenceInstructions),
      Config.node.replace(config),
      Snapshot.node.replace(Snapshot.noopLayer),
      PluginSupervisor.node.replace(pluginSupervisor),
      SessionExecution.node.replace(execution(llmClient)),
    ],
  )
const it = testEffect(testLayer(client))
const sessionID = Session.ID.make("ses_runner_recorded")

describe("SessionRunnerLLM recorded", () => {
  it.effect("executes one recorded prompt through the recorded HTTP transport", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((draft) =>
        draft.update(Agent.ID.make("build"), (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "execute", resource: "*", effect: "deny" })
        }),
      )
      const pluginHost = host({
        agent: agentHost(agents),
        catalog: catalogHost(catalog),
        session: { hook: (name, callback) => hooks.register("session", name, callback) },
      })
      yield* Effect.forEach(SystemPromptPlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
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
    }),
  )
})

describe("SessionModelRequest HTTP bridge", () => {
  const bodies: Uint8Array[] = []
  const methods: string[] = []
  const headers: Array<string | undefined> = []
  const response = [
    'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello!"},"finish_reason":null}]}',
    'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    "data: [DONE]",
    "",
  ].join("\n\n")
  const transport = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        if (request.body._tag !== "Uint8Array") throw new Error(`Unexpected request body: ${request.body._tag}`)
        methods.push(request.method)
        bodies.push(request.body.body.slice())
        headers.push(request.headers["x-hook"])
        return HttpClientResponse.fromWeb(
          request,
          new Response(response, { headers: { "content-type": "text/event-stream" } }),
        )
      }),
    ),
  )
  const httpIt = testEffect(
    testLayer(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(transport))))),
  )

  httpIt.effect("runs Effect HTTP request and response hooks around one provider request", () =>
    Effect.gen(function* () {
      bodies.length = 0
      methods.length = 0
      headers.length = 0
      const seen: string[] = []
      const agents = yield* Agent.Service
      const catalog = yield* Catalog.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((draft) =>
        draft.update(Agent.ID.make("build"), (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "execute", resource: "*", effect: "deny" })
        }),
      )
      const pluginHost = host({
        agent: agentHost(agents),
        catalog: catalogHost(catalog),
        session: { hook: (name, callback) => hooks.register("session", name, callback) },
      })
      yield* pluginHost.session.hook("http.request", (event) =>
        Effect.sync(() => {
          seen.push("request")
          event.request.headers.set("x-hook", "effect")
        }),
      )
      yield* pluginHost.session.hook("http.response", (event) =>
        Effect.gen(function* () {
          seen.push(`response:${event.response.status}:${event.request.headers.get("x-hook")}`)
          event.response = new Response(
            (yield* Effect.promise(() => event.response.text())).replace("Hello!", "Hooked!"),
            event.response,
          )
        }),
      )
      yield* Effect.forEach(SystemPromptPlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const sessionID = Session.ID.make("ses_model_request_http")
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
        .run()
        .pipe(Effect.orDie)
      const session = yield* Session.Service
      yield* session.prompt({ sessionID, text: "Say hello.", resume: false })

      yield* session.resume(sessionID)

      expect(methods).toEqual(["POST"])
      expect(headers).toEqual(["effect"])
      expect(seen).toEqual(["request", "response:200:effect"])
      expect(bodies).toHaveLength(1)
      expect(bodies[0]?.byteLength).toBeGreaterThan(0)
      expect((yield* session.context(sessionID))[1]).toMatchObject({
        type: "assistant",
        content: [{ type: "text", text: "Hooked!" }],
      })
    }),
  )
})
