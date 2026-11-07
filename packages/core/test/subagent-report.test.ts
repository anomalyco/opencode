import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTable } from "@opencode/core/session/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const childText = "Review complete"
const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text(childText, "review") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Database.node, Session.node, Job.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: "review", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ]),
  ),
)

const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })

/** A parent and its child in one directory, configured so the child may run without prompts. */
const family = Effect.fnUntraced(function* (metadata?: SessionSchema.Metadata) {
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      `${dir.path}/opencode.json`,
      JSON.stringify({
        agents: { reviewer: { mode: "subagent" } },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    ),
  )
  const sessions = yield* Session.Service
  const parent = yield* sessions.create({
    location: { directory: AbsolutePath.make(dir.path) },
    agent: Agent.ID.make("build"),
    model: parentModel,
  })
  const child = yield* sessions.create({
    parentID: parent.id,
    agent: Agent.ID.make("reviewer"),
    title: "Review fixture",
    ...(metadata === undefined ? {} : { metadata }),
  })
  return { sessions, parent, child }
})

const synthetics = (sessions: Session.Interface, sessionID: Session.ID) =>
  sessions.context(sessionID).pipe(
    Effect.map((messages) => messages.filter((message) => message.type === "synthetic")),
  )

/**
 * A job that stands in for the child's spawn without an observer or a notification ID, so only
 * settlement can report a busy period it overlaps.
 */
const startChildJob = (
  jobs: Job.Interface,
  parent: SessionSchema.Info,
  child: SessionSchema.Info,
  run: Effect.Effect<string, unknown>,
) =>
  jobs.start({
    id: child.id,
    type: "subagent",
    recovery: {
      kind: "subagent",
      parentSessionID: parent.id,
      childSessionID: child.id,
      agent: "reviewer",
      description: "Review fixture",
    },
    run,
  })

describe("subagent report", () => {
  it.live("reports a directly prompted child to its parent once", () =>
    Effect.gen(function* () {
      const { sessions, parent, child } = yield* family()
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)

      const reports = yield* synthetics(sessions, parent.id)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        description: "Review fixture",
        metadata: { source: "subagent", childID: child.id, agent: "reviewer", state: "completed" },
      })
      expect(reports[0]?.text).toContain(`<subagent sessionID="${child.id}" state="completed"`)
      expect(reports[0]?.text).toContain(childText)
      // A report is one message, not a durable background marker.
      expect(yield* (yield* Job.Service).pendingBackground).toEqual([])
    }),
  )

  it.live("reports each later busy period of the same child separately", () =>
    Effect.gen(function* () {
      const { sessions, parent, child } = yield* family()
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)
      yield* sessions.prompt({ sessionID: child.id, text: "Review it again" })
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)

      const reports = yield* synthetics(sessions, parent.id)
      expect(reports).toHaveLength(2)
      expect(new Set(reports.map((report) => report.id)).size).toBe(2)
      expect(reports.map((report) => report.metadata)).toEqual([
        expect.objectContaining({ childID: child.id, state: "completed" }),
        expect.objectContaining({ childID: child.id, state: "completed" }),
      ])
    }),
  )

  it.live("stays silent when the child asked not to notify", () =>
    Effect.gen(function* () {
      const { sessions, parent, child } = yield* family({ "subagent.notify": false })
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)

      expect(yield* synthetics(sessions, parent.id)).toEqual([])
    }),
  )

  it.live("reports a user interruption as cancelled", () =>
    Effect.gen(function* () {
      const { sessions, parent, child } = yield* family()
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })
      yield* gate.started
      yield* sessions.interrupt(child.id)
      yield* gate.release
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)

      const reports = yield* synthetics(sessions, parent.id)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        metadata: { source: "subagent", childID: child.id, state: "cancelled" },
      })
    }),
  )

  it.live("reports a period whose starting job completed during it", () =>
    Effect.gen(function* () {
      const { sessions, parent, child } = yield* family()
      const jobs = yield* Job.Service
      const release = yield* Deferred.make<void>()
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()
      yield* startChildJob(
        jobs,
        parent,
        child,
        Deferred.await(release).pipe(Effect.as("stale answer")),
      )
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })
      yield* gate.started
      // The generation that began this period finishes on its own, settling an earlier period.
      yield* Deferred.succeed(release, undefined)
      expect((yield* jobs.wait({ id: child.id })).info?.status).toBe("completed")
      yield* gate.release
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)

      const reports = yield* synthetics(sessions, parent.id)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        metadata: { source: "subagent", childID: child.id, state: "completed" },
      })
      expect(reports[0]?.text).toContain(childText)
    }),
  )

  it.live("stays silent when the starting job is cancelled during the period", () =>
    Effect.gen(function* () {
      const { sessions, parent, child } = yield* family()
      const jobs = yield* Job.Service
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()
      yield* startChildJob(jobs, parent, child, Effect.never)
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })
      yield* gate.started
      yield* jobs.cancel(child.id)
      yield* gate.release
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)

      expect(yield* synthetics(sessions, parent.id)).toEqual([])
    }),
  )

  it.live("does not let a cancelled earlier period silence a later one", () =>
    Effect.gen(function* () {
      const { sessions, parent, child } = yield* family()
      const jobs = yield* Job.Service
      yield* startChildJob(jobs, parent, child, Effect.never)
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)
      // The running job owns period one, so only its cancellation could have reported it.
      expect(yield* synthetics(sessions, parent.id)).toEqual([])
      yield* jobs.cancel(child.id)
      yield* sessions.prompt({ sessionID: child.id, text: "Review it again" })
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)

      const reports = yield* synthetics(sessions, parent.id)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        metadata: { source: "subagent", childID: child.id, state: "completed" },
      })
      expect(reports[0]?.text).toContain(childText)
    }),
  )

  it.live("settles without a parent", () =>
    Effect.gen(function* () {
      const { sessions, child } = yield* family()
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({ parent_id: Session.ID.make("ses_missing_parent") })
        .where(eq(SessionTable.id, child.id))
        .run()
      yield* sessions.prompt({ sessionID: child.id, text: "Review the fixture" })

      yield* sessions.wait(child.id)
      expect((yield* sessions.get(child.id)).parentID).toBe(Session.ID.make("ses_missing_parent"))
    }),
  )
})
