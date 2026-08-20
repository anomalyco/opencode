import { expect } from "bun:test"
import { LLMClient, LLMEvent, LanguageModel, type LLMRequest } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { Agent } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTitle } from "@opencode-ai/core/session/title"
import { Session } from "@opencode-ai/core/session"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { App } from "@opencode-ai/core/app"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Money } from "@opencode-ai/schema/money"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

let requests: LLMRequest[] = []
const model = LanguageModel.make({
  id: "title-model",
  provider: "test",
  route: OpenAIChat.route.with({ limits: { context: 10_000, output: 1_000 } }),
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
const successfulTitle = () =>
  Stream.make(
    LLMEvent.textDelta({ id: "title", text: "Generated Title\n" }),
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
let titleStream: () => Stream.Stream<LLMEvent> = successfulTitle
const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    return titleStream()
  },
  generate: () => Effect.die("unused"),
})
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () =>
    Effect.succeed(
      SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost,
        limit: { context: 200_000, output: 32_000 },
      }),
    ),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Agent.node, SessionTitle.node]),
    [
      [llmClient, client],
      [SessionRunnerModel.node, models],
    ],
  ),
)

const insertSession = (id: Session.ID, title?: string, created?: number) =>
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
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title,
        time_created: created,
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const prompt = (sessionID: Session.ID, text: string) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const messageID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.InboxEnqueued, {
      sessionID,
      inboxID: messageID,
      item: { type: "user", payload: { text }, delivery: "steer" },
    })
    yield* bus.publish(SessionEvent.InboxDelivered, {
      sessionID,
      inboxID: messageID,
    })
  })

it.effect("generates a title from the sole user message and renames the session", () =>
  Effect.gen(function* () {
    requests = []
    titleStream = successfulTitle
    const agentService = yield* Agent.Service
    yield* agentService.transform((editor) => {
      editor.update(Agent.ID.make("title"), (agent) => {
        agent.mode = "primary"
        agent.hidden = true
        agent.system = "You are a title generator."
      })
    })
    const sessionID = Session.ID.make("ses_title_generate")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(sessionID)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.http?.headers).toEqual({
      "x-session-affinity": sessionID,
      "X-Session-Id": sessionID,
      "User-Agent": App.useragent(App.make()),
      "x-opencode-project": Project.ID.global,
      "x-opencode-session": sessionID,
      "x-opencode-client": "opencode",
    })
    expect(JSON.stringify(requests[0]?.messages)).toContain("Help me debug the failing build")
    const renamed = yield* store.get(sessionID)
    expect(renamed?.title).toBe("Generated Title")
    expect(renamed?.tokens).toEqual({ input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } })
    expect(renamed?.cost).toBeCloseTo(0.0000233)
  }),
)

it.effect("generates from the first user message after later messages exist", () =>
  Effect.gen(function* () {
    requests = []
    titleStream = successfulTitle
    const agentService = yield* Agent.Service
    yield* agentService.transform((editor) => {
      editor.update(Agent.ID.make("title"), (agent) => {
        agent.mode = "primary"
        agent.hidden = true
        agent.system = "You are a title generator."
      })
    })
    const sessionID = Session.ID.make("ses_title_second_message")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "First message")
    yield* prompt(sessionID, "Second message")

    const store = yield* SessionStore.Service
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(sessionID)

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.messages)).toContain("First message")
    expect(JSON.stringify(requests[0]?.messages)).not.toContain("Second message")
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("retries a legacy persisted fallback title", () =>
  Effect.gen(function* () {
    requests = []
    titleStream = successfulTitle
    const agentService = yield* Agent.Service
    yield* agentService.transform((editor) => {
      editor.update(Agent.ID.make("title"), (agent) => {
        agent.mode = "primary"
        agent.hidden = true
        agent.system = "You are a title generator."
      })
    })
    const sessionID = Session.ID.make("ses_title_legacy")
    const created = Date.parse("2026-07-30T18:45:03.662Z")
    yield* insertSession(sessionID, "New session - 2026-07-30T18:45:03.662Z", created)
    yield* prompt(sessionID, "Retry the legacy title")

    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("does not generate for a child session", () =>
  Effect.gen(function* () {
    requests = []
    titleStream = successfulTitle
    const agentService = yield* Agent.Service
    yield* agentService.transform((editor) => {
      editor.update(Agent.ID.make("title"), (agent) => {
        agent.mode = "primary"
        agent.hidden = true
        agent.system = "You are a title generator."
      })
    })
    const sessionID = Session.ID.make("ses_title_child")
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
        parent_id: Session.ID.make("ses_title_parent"),
        slug: sessionID,
        directory: "/project",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* prompt(sessionID, "Do this subtask")

    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(sessionID)

    expect(requests).toHaveLength(0)
  }),
)

it.effect("does not generate when the title agent is removed", () =>
  Effect.gen(function* () {
    requests = []
    titleStream = successfulTitle
    const sessionID = Session.ID.make("ses_title_no_agent")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(sessionID)

    expect(requests).toHaveLength(0)
    const untouched = yield* store.get(sessionID)
    expect(untouched?.title).toBeUndefined()
  }),
)

it.effect("does not overwrite an explicit title", () =>
  Effect.gen(function* () {
    requests = []
    titleStream = successfulTitle
    const sessionID = Session.ID.make("ses_title_explicit")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")
    const events = yield* Bus.Service
    yield* events.publish(SessionEvent.Renamed, { sessionID, title: "New session - 2099-01-01T00:00:00.000Z" })

    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(0)
    expect((yield* store.get(sessionID))?.title).toBe("New session - 2099-01-01T00:00:00.000Z")
  }),
)

it.effect("retries after a failed title request", () =>
  Effect.gen(function* () {
    requests = []
    const agentService = yield* Agent.Service
    yield* agentService.transform((editor) => {
      editor.update(Agent.ID.make("title"), (agent) => {
        agent.mode = "primary"
        agent.hidden = true
        agent.system = "You are a title generator."
      })
    })
    const sessionID = Session.ID.make("ses_title_retry")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Retry this title")
    const title = yield* SessionTitle.Service
    titleStream = () => Stream.make(LLMEvent.providerError({ message: "Provider unavailable" }))

    yield* title.generateForFirstPrompt(sessionID)
    titleStream = successfulTitle
    yield* title.generateForFirstPrompt(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(2)
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("preserves a manual rename completed while generation is in flight", () =>
  Effect.gen(function* () {
    requests = []
    const agentService = yield* Agent.Service
    yield* agentService.transform((editor) => {
      editor.update(Agent.ID.make("title"), (agent) => {
        agent.mode = "primary"
        agent.hidden = true
        agent.system = "You are a title generator."
      })
    })
    const sessionID = Session.ID.make("ses_title_manual_rename")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Generate this title")
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    titleStream = () =>
      Stream.unwrap(
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as(successfulTitle()),
        ),
      )
    const title = yield* SessionTitle.Service
    const fiber = yield* title.generateForFirstPrompt(sessionID).pipe(Effect.forkScoped)
    yield* Deferred.await(started)
    const events = yield* Bus.Service
    yield* events.publish(SessionEvent.Renamed, { sessionID, title: "Manual title" })
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(fiber)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect((yield* store.get(sessionID))?.title).toBe("Manual title")
  }),
)
