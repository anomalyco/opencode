import { expect, test } from "bun:test"
import { LLMClient, LLMEvent, LanguageModel, SystemPart, type LLMRequest } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Session } from "@opencode-ai/core/session"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { App } from "@opencode-ai/core/app"
import { Agent } from "@opencode-ai/core/agent"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Money } from "@opencode-ai/schema/money"
import { DateTime, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

let requests: LLMRequest[] = []
const model = LanguageModel.make({
  id: "summary-model",
  provider: "test",
  route: OpenAIChat.route,
})
const cost = [
  {
    input: Money.USDPerMillionTokens.make(1),
    output: Money.USDPerMillionTokens.make(2),
    cache: {
      read: Money.USDPerMillionTokens.make(0.1),
      write: Money.USDPerMillionTokens.make(0.5),
    },
  },
]
const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    return Stream.make(
      LLMEvent.textDelta({ id: "summary", text: "manual summary" }),
      LLMEvent.stepFinish({
        index: 0,
        reason: { normalized: "stop" },
        usage: {
          inputTokens: 15,
          outputTokens: 6,
          nonCachedInputTokens: 10,
          cacheReadInputTokens: 3,
          cacheWriteInputTokens: 2,
          reasoningTokens: 2,
        },
      }),
      LLMEvent.finish({
        reason: { normalized: "stop" },
      }),
    )
  },
  generate: () => Effect.die("unused"),
})
const resolved = SessionRunnerModel.resolved(model, {
  capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
  cost,
  limit: { context: 200_000, output: 32_000 },
})
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () => Effect.succeed(resolved),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      PluginHooks.node,
      SessionCompaction.node,
    ]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [llmClient, client],
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

test("compaction truncation does not split surrogate pairs", () => {
  const prefix = "a".repeat(1_999)

  expect(SessionCompaction.truncateToolOutput(`${prefix}😀suffix`)).toBe(`${prefix}😀\n[truncated]`)
  expect(SessionCompaction.truncateToolOutput("😀".repeat(2_000))).toBe("😀".repeat(2_000))
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

it.effect("auto compaction reserves a buffer below the prompt ceiling", () =>
  Effect.gen(function* () {
    const compaction = yield* SessionCompaction.Service
    const session = Session.Info.make({
      id: Session.ID.make("ses_input_limit"),
      projectID: Project.ID.global,
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      location: Location.Ref.make({ directory: AbsolutePath.make("/tmp") }),
    })
    const input = (tokens: number, limit: { context: number; input?: number; output: number }) => ({
      session,
      resolved: SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [],
        limit,
      }),
      messages: [
        Schema.decodeUnknownSync(SessionMessage.Assistant)({
          id: SessionMessage.ID.make("msg_assistant"),
          type: "assistant",
          agent: Agent.defaultID,
          model: { id: "test-model", providerID: "test-provider" },
          content: [],
          tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, completed: 0 },
        }),
      ],
    })

    const inputLimited = { context: 400_000, input: 272_000, output: 128_000 }
    expect(compaction.required(input(251_999, inputLimited))).toBe(false)
    expect(compaction.required(input(252_000, inputLimited))).toBe(true)

    const contextLimited = { context: 100_000, output: 10_000 }
    expect(compaction.required(input(79_999, contextLimited))).toBe(false)
    expect(compaction.required(input(80_000, contextLimited))).toBe(true)

    const outputLimited = { context: 100_000, output: 30_000 }
    expect(compaction.required(input(69_999, outputLimited))).toBe(false)
    expect(compaction.required(input(70_000, outputLimited))).toBe(true)
  }),
)

/** Seeds the global project plus one session row, returning the projected session. */
const insertSession = (id: Session.ID, overrides?: Partial<typeof SessionTable.$inferInsert>) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: id,
        version: "test",
        ...overrides,
      })
      .run()
      .pipe(Effect.orDie)
    const store = yield* SessionStore.Service
    return yield* store
      .get(id)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die(`session missing: ${id}`))))
  })

it.effect("manual compaction summarizes short context instead of no-op", () =>
  Effect.gen(function* () {
    requests = []
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const sessionID = Session.ID.make("ses_manual_compaction")
    const parentID = Session.ID.make("ses_manual_compaction_parent")
    const userMessage = {
      id: SessionMessage.ID.create(),
      type: "user" as const,
      text: "Manual compaction should include this short conversation.",
      time: { created: DateTime.makeUnsafe(0) },
    }
    const session = yield* insertSession(sessionID, { parent_id: parentID })

    const delta = yield* bus
      .subscribe(SessionEvent.Compaction.Delta)
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
    yield* Effect.yieldNow
    expect(
      yield* compaction.compactManual({
        session,
        messages: [userMessage],
        inputID: SessionMessage.ID.make("msg_manual_compaction"),
      }),
    ).toEqual({ status: "completed" })
    expect(Array.from(yield* Fiber.join(delta)).map((event) => event.data.text)).toEqual(["manual summary"])

    expect(requests).toHaveLength(1)
    expect(requests[0]?.promptCacheKey).toBe(sessionID)
    expect(requests[0]?.http?.headers).toEqual({
      "x-session-affinity": sessionID,
      "X-Session-Id": sessionID,
      "x-parent-session-id": parentID,
      "User-Agent": App.useragent(App.make()),
      "x-opencode-project": Project.ID.global,
      "x-opencode-session": sessionID,
      "x-opencode-client": "opencode",
    })
    expect(requests[0]?.generation).toBeUndefined()
    expect(JSON.stringify(requests[0]?.messages)).toContain("Manual compaction should include this short conversation.")
    expect(yield* store.context(sessionID)).toMatchObject([
      { type: "compaction", reason: "manual", summary: "manual summary", recent: "" },
    ])
    expect(yield* store.get(sessionID)).toMatchObject({
      cost: 0.0000233,
      tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } },
    })
    expect(
      yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([
      { type: Bus.versionedType(SessionEvent.Compaction.Started.type, 1) },
      { type: Bus.versionedType(SessionEvent.UsageRecorded.type, 1) },
      { type: Bus.versionedType(SessionEvent.Compaction.Ended.type, 1) },
    ])
  }),
)

it.effect("forked session compaction reuses the fork root prompt cache key", () =>
  Effect.gen(function* () {
    requests = []
    const compaction = yield* SessionCompaction.Service
    const sessionID = Session.ID.make("ses_fork_compaction")
    const rootID = Session.ID.make("ses_fork_compaction_root")
    const session = yield* insertSession(sessionID, {
      fork_session_id: rootID,
      fork_boundary: { type: "before", messageID: SessionMessage.ID.create() },
    })
    expect(
      yield* compaction.compactManual({
        session,
        messages: [
          {
            id: SessionMessage.ID.create(),
            type: "user",
            text: "Summarize the forked conversation.",
            time: { created: DateTime.makeUnsafe(0) },
          },
        ],
        inputID: SessionMessage.ID.make("msg_fork_compaction"),
      }),
    ).toEqual({ status: "completed" })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.promptCacheKey).toBe(rootID)
  }),
)

it.effect("keeps session context hooks away from compaction requests", () =>
  Effect.gen(function* () {
    requests = []
    const compaction = yield* SessionCompaction.Service
    // Context hooks shape the agent conversation; compaction is not part of it,
    // so it opts out and the transcript passes through unchanged.
    const hooks = yield* PluginHooks.Service
    yield* hooks.register("session", "context", (event) =>
      Effect.sync(() => {
        event.system.push(SystemPart.make("Injected conversation context"))
      }),
    )
    const session = yield* insertSession(Session.ID.make("ses_hook_compaction"))
    expect(
      yield* compaction.compactManual({
        session,
        messages: [
          {
            id: SessionMessage.ID.create(),
            type: "user",
            text: "Summarize this conversation.",
            time: { created: DateTime.makeUnsafe(0) },
          },
        ],
        inputID: SessionMessage.ID.make("msg_hook_compaction"),
      }),
    ).toEqual({ status: "completed" })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.system).toEqual([])
  }),
)
