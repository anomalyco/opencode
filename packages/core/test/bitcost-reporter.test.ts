import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Option } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { BitcostClient } from "@opencode-ai/core/bitcost/client"
import { BitcostReporter } from "@opencode-ai/core/bitcost/reporter"
import { testEffect } from "./lib/effect"

// Records every usage report the reporter forks, so the test can assert the
// listener fired and built the right payload. Reset per test (tests run serially).
const reports: BitcostClient.UsageReport[] = []

const stubClient = Layer.succeed(
  BitcostClient.Service,
  BitcostClient.Service.of({
    auth: () => Effect.succeed(Option.none()),
    isLoggedIn: () => Effect.succeed(true),
    listTasks: () => Effect.succeed([]),
    createTask: () => Effect.succeed({ id: "1" }),
    completeTask: () => Effect.void,
    reportUsage: (report) => Effect.sync(() => void reports.push(report)),
    attachPlan: () => Effect.void,
  }),
)

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
// Wire the REAL reporter layer exactly as the server does (events + database +
// client), so building it subscribes via events.listen on the same EventV2.
const reporter = BitcostReporter.layer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(stubClient),
)
const it = testEffect(Layer.mergeAll(database, events, reporter))

const created = DateTime.makeUnsafe(0)
const model = { id: ModelV2.ID.make("gpt-5.4"), providerID: ProviderV2.ID.make("openai") }

const seedSession = (sessionID: string, opts: { taskID?: string | null; withModel?: boolean }) =>
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
        id: SessionV2.ID.make(sessionID),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        bitcost_task_id: opts.taskID ?? null,
        model: opts.withModel === false ? null : model,
      })
      .run()
      .pipe(Effect.orDie)
  })

const publishStepEnded = (sessionID: string) =>
  Effect.gen(function* () {
    const ev = yield* EventV2.Service
    yield* ev.publish(SessionEvent.Step.Ended, {
      sessionID: SessionV2.ID.make(sessionID),
      timestamp: created,
      assistantMessageID: SessionMessage.ID.make("msg_step"),
      finish: "stop",
      cost: 0.0125,
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 1 } },
    })
    // The reporter forks the POST; give the detached fiber a tick to run.
    yield* Effect.sleep("50 millis")
  })

describe("BitcostReporter", () => {
  it.live("reports usage to the bound task when a Step.Ended fires", () =>
    Effect.gen(function* () {
      reports.length = 0
      const sessionID = "ses_reporter_bound"
      yield* seedSession(sessionID, { taskID: "1" })
      yield* publishStepEnded(sessionID)

      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        taskID: "1",
        provider: "openai",
        model: "gpt-5.4",
        cost: 0.0125,
        tokens: { input: 10, output: 5, cache: { read: 2, write: 1 } },
      })
    }),
  )

  it.live("skips reporting when the session has no bound task", () =>
    Effect.gen(function* () {
      reports.length = 0
      const sessionID = "ses_reporter_unbound"
      yield* seedSession(sessionID, { taskID: null })
      yield* publishStepEnded(sessionID)

      expect(reports).toHaveLength(0)
    }),
  )
})
