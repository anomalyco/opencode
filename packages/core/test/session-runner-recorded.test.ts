import { HttpRecorder } from "@daemon-protocol/http-recorder"
import { HttpRecorderInternal } from "@daemon-protocol/http-recorder/internal"
import * as OpenAIChat from "@daemon-protocol/llm/protocols/openai-chat"
import { Auth, LLMClient, RequestExecutor } from "@daemon-protocol/llm/route"
import { Database } from "@daemon-protocol/core/database/database"
import { EventV2 } from "@daemon-protocol/core/event"
import { EventTable } from "@daemon-protocol/core/event/sql"
import { PermissionV2 } from "@daemon-protocol/core/permission"
import { AgentV2 } from "@daemon-protocol/core/agent"
import { Config } from "@daemon-protocol/core/config"
import { Project } from "@daemon-protocol/core/project"
import { ProjectTable } from "@daemon-protocol/core/project/sql"
import { AbsolutePath } from "@daemon-protocol/core/schema"
import { SessionV2 } from "@daemon-protocol/core/session"
import { Prompt } from "@daemon-protocol/core/session/prompt"
import { SessionProjector } from "@daemon-protocol/core/session/projector"
import { SessionExecution } from "@daemon-protocol/core/session/execution"
import { SessionRunCoordinator } from "@daemon-protocol/core/session/run-coordinator"
import * as SessionRunnerLLM from "@daemon-protocol/core/session/runner/llm"
import { SessionRunnerModel } from "@daemon-protocol/core/session/runner/model"
import { ToolRegistry } from "@daemon-protocol/core/tool/registry"
import { SessionTable } from "@daemon-protocol/core/session/sql"
import { SessionStore } from "@daemon-protocol/core/session/store"
import { Location } from "@daemon-protocol/core/location"
import { SystemContextRegistry } from "@daemon-protocol/core/system-context/registry"
import { SystemContext } from "@daemon-protocol/core/system-context"
import { SkillGuidance } from "@daemon-protocol/core/skill/guidance"
import { ReferenceGuidance } from "@daemon-protocol/core/reference/guidance"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import path from "node:path"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const store = SessionStore.layer.pipe(Layer.provide(database))
const cassette =
  process.env.RECORD === "true"
    ? HttpRecorderInternal.cassetteLayer("session-runner/openai-chat-streams-text", {
        directory: path.resolve(import.meta.dir, "fixtures/recordings"),
        mode: "record",
      })
    : HttpRecorder.http("session-runner/openai-chat-streams-text", {
        directory: path.resolve(import.meta.dir, "fixtures/recordings"),
      })
const executor = RequestExecutor.layer.pipe(Layer.provide(cassette))
const client = LLMClient.layer.pipe(Layer.provide(executor))
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const agents = AgentV2.layer
const model = OpenAIChat.route
  .with({
    endpoint: { baseURL: "https://api.openai.com/v1" },
    auth: Auth.bearer(process.env.OPENAI_API_KEY ?? "fixture"),
    generation: { maxTokens: 20, temperature: 0 },
  })
  .model({ id: "gpt-4o-mini" })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const systemContext = SystemContextRegistry.layer
const location = Location.layer({ directory: AbsolutePath.make("/project") }).pipe(Layer.provide(Project.defaultLayer))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const runner = SessionRunnerLLM.defaultLayer.pipe(
  Layer.provide(database),
  Layer.provide(store),
  Layer.provide(events),
  Layer.provide(client),
  Layer.provide(registry),
  Layer.provide(models),
  Layer.provide(systemContext),
  Layer.provide(location),
  Layer.provide(agents),
  Layer.provide(skillGuidance),
  Layer.provide(referenceGuidance),
  Layer.provide(config),
)
const coordinator = SessionRunCoordinator.layer.pipe(Layer.provide(runner))
const execution = Layer.effect(
  SessionExecution.Service,
  SessionRunCoordinator.Service.pipe(
    Effect.map((coordinator) =>
      SessionExecution.Service.of({
        resume: coordinator.run,
        wake: coordinator.wake,
        interrupt: coordinator.interrupt,
      }),
    ),
  ),
).pipe(Layer.provide(coordinator))
const sessions = SessionV2.layer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(store),
  Layer.provide(Project.defaultLayer),
  Layer.provide(execution),
)
const it = testEffect(
  Layer.mergeAll(
    database,
    events,
    projector,
    store,
    executor,
    client,
    permission,
    agents,
    registry,
    models,
    systemContext,
    location,
    skillGuidance,
    config,
    runner,
    coordinator,
    execution,
    sessions,
  ),
)
const sessionID = SessionV2.ID.make("ses_runner_recorded")

describe("SessionRunnerLLM recorded", () => {
  it.effect("executes one recorded V2 prompt through the recorded HTTP transport", () =>
    Effect.gen(function* () {
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
      const session = yield* SessionV2.Service
      const prompt = yield* session.prompt({
        sessionID,
        prompt: new Prompt({ text: "Say hello in one short sentence." }),
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
        "session.next.prompt.admitted.1",
        "session.next.prompt.promoted.1",
        "session.next.step.started.1",
        "session.next.text.started.1",
        "session.next.text.ended.1",
        "session.next.step.ended.2",
      ])
    }),
  )
})
