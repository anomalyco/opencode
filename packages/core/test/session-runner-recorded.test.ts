import { NodeFileSystem } from "@effect/platform-node"
import { HttpRecorder } from "@opencode-ai/http-recorder"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Auth, LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRuntime } from "@opencode-ai/core/session/runtime"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import path from "node:path"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const cassette = HttpRecorder.cassetteLayer("session-runner/openai-chat-streams-text", {
  directory: path.resolve(import.meta.dir, "fixtures/recordings"),
  mode: process.env.RECORD === "true" ? "record" : "replay",
}).pipe(Layer.provide(NodeFileSystem.layer))
const executor = RequestExecutor.layer.pipe(Layer.provide(cassette))
const client = LLMClient.layer.pipe(Layer.provide(executor))
const registry = ToolRegistry.layer()
const model = OpenAIChat.route
  .with({
    endpoint: { baseURL: "https://api.openai.com/v1" },
    auth: Auth.bearer(process.env.OPENAI_API_KEY ?? "fixture"),
    generation: { maxTokens: 20, temperature: 0 },
  })
  .model({ id: "gpt-4o-mini" })
const models = SessionRunnerModel.layer(() => Effect.succeed(model))
const runner = SessionRunnerLLM.layer.pipe(Layer.provide(database), Layer.provide(events), Layer.provide(client), Layer.provide(models))
  .pipe(Layer.provide(registry))
const runtime = SessionRuntime.localLayer.pipe(Layer.provide(events), Layer.provide(database), Layer.provide(runner))
const sessions = SessionV2.layer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(Project.defaultLayer),
  Layer.provide(runtime),
)
const it = testEffect(Layer.mergeAll(database, events, projector, executor, client, registry, models, runner, runtime, sessions))
const sessionID = SessionV2.ID.make("ses_runner_recorded")

describe("SessionRunnerLLM recorded", () => {
  it.effect("executes one admitted V2 prompt through the recorded HTTP transport", () =>
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
        .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", title: "test", version: "test" })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const session = yield* SessionV2.Service
      const prompt = yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Say hello in one short sentence." }), resume: false })

      yield* session.resume(sessionID)

      const messages = yield* session.context(sessionID)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual(prompt)
      expect(messages[1]).toMatchObject({ type: "assistant", agent: "build", finish: "stop" })
      expect(messages[1]?.type === "assistant" ? messages[1].content : []).toMatchObject([{ type: "text", text: "Hello!" }])
      expect(
        (yield* db.select({ type: EventTable.type }).from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).all())
          .map((event) => event.type),
      ).toEqual([
        "session.next.prompted.1",
        "session.next.step.started.1",
        "session.next.text.started.1",
        "session.next.text.delta.1",
        "session.next.text.delta.1",
        "session.next.text.ended.1",
        "session.next.step.ended.1",
      ])
    }),
  )
})
