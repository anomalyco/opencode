import { expect, test } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionV2 } from "@opencode-ai/core/session"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { DateTime, Effect, Fiber, Layer, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

let requests: LLMRequest[] = []
const model = Model.make({
  id: "summary-model",
  provider: "test",
  route: OpenAIChat.route.with({ limits: { context: 10_000, output: 1_000 } }),
})
const client = Layer.mock(LLMClient.Service)({
  prepare: () => Effect.die("unused"),
  stream: (request: LLMRequest) => {
    requests.push(request)
    return Stream.make(LLMEvent.textDelta({ id: "summary", text: "manual summary" }))
  },
  generate: () => Effect.die("unused"),
})
const config = Layer.mock(Config.Service)({ entries: () => Effect.succeed([]) })
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () => Effect.succeed(SessionRunnerModel.resolved(model)),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionCompaction.node]),
    [
      [llmClient, client],
      [Config.node, config],
      [SessionRunnerModel.node, models],
    ],
  ),
)

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

test("compaction prompt requires the checkpoint headings in order", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["Conversation history"] })
  expect(prompt.match(/^#{2,3} .+$/gm)).toEqual([
    "## Objective",
    "## Important Details",
    "## Work State",
    "### Completed",
    "### Active",
    "### Blocked",
    "## Next Move",
    "## Relevant Files",
  ])
  expect(prompt).toContain("one or two brief sentences")
  expect(prompt).toContain("constraints/preferences, decisions and why")
  expect(prompt).toContain("immediate concrete action")
  expect(prompt).toContain("next action if known")
  expect(prompt).toContain("Keep every section, even when empty.")
})

it.effect("manual compaction summarizes short context instead of no-op", () =>
  Effect.gen(function* () {
    requests = []
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service
    const sessionID = SessionV2.ID.make("ses_manual_compaction")
    const userMessage = {
      id: SessionMessage.ID.create(),
      type: "user" as const,
      text: "Manual compaction should include this short conversation.",
      time: { created: DateTime.makeUnsafe(0) },
    }
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
        slug: "manual-compaction",
        directory: "/project",
        title: "Manual compaction",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)

    const session = yield* store
      .get(sessionID)
      .pipe(
        Effect.flatMap((session) =>
          session ? Effect.succeed(session) : Effect.die("manual compaction test session missing"),
        ),
      )

    const delta = yield* events
      .subscribe(SessionEvent.Compaction.Delta)
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
    yield* Effect.yieldNow
    expect(
      yield* compaction.compactManual({
        session,
        messages: [userMessage],
        inputID: SessionMessage.ID.make("msg_manual_compaction"),
      }),
    ).toBe(true)
    expect(Array.from(yield* Fiber.join(delta)).map((event) => event.data.text)).toEqual(["manual summary"])

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.messages)).toContain("Manual compaction should include this short conversation.")
    expect(yield* store.context(sessionID)).toMatchObject([
      { type: "compaction", reason: "manual", summary: "manual summary", recent: "" },
    ])
    expect(
      yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([
      { type: EventV2.versionedType(SessionEvent.Compaction.Started.type, 1) },
      { type: EventV2.versionedType(SessionEvent.Compaction.Ended.type, 1) },
    ])
  }),
)
