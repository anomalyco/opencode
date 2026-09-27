import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Exit, Layer } from "effect"
import { Artifact } from "@opencode-ai/core/artifact"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set<SessionV2.ID>()),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      Artifact.node,
    ]),
    [[SessionExecution.node, execution]],
  ),
)

const sessionA = SessionV2.ID.make("ses_artifact_a")
const sessionB = SessionV2.ID.make("ses_artifact_b")
const sessionGone = SessionV2.ID.make("ses_artifact_gone")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      { id: sessionA, project_id: Project.ID.global, slug: "a", directory: "/project", title: "a", version: "test" },
      { id: sessionB, project_id: Project.ID.global, slug: "b", directory: "/project", title: "b", version: "test" },
    ])
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const seed = (input: { sessionID?: SessionV2.ID; task: string; type?: Artifact.Type }): Artifact.CreateInput => ({
  projectID: Project.ID.global,
  ...(input.sessionID !== undefined ? { sessionID: input.sessionID } : {}),
  name: `artifact for ${input.task}`,
  type: input.type ?? "TEST_RESULT",
  content: "5 of 5 flows passed",
  agent: "browser",
  task: input.task,
})

describe("Artifact", () => {
  it.effect("creates, reads, lists, and versions artifacts", () =>
    Effect.gen(function* () {
      yield* setup
      const artifacts = yield* Artifact.Service

      const created = yield* artifacts.create(seed({ sessionID: sessionA, task: "task-crud" }))
      expect(created.id).toStartWith("art_")
      expect(created.version).toBe(1)
      expect(created.status).toBe("draft")
      expect(created.sessionID).toBe(sessionA)
      expect(created.comments).toEqual([])
      expect(created.diff).toBeUndefined()

      const fetched = yield* artifacts.get(created.id)
      expect(fetched).toEqual(created)

      const missing = yield* Effect.exit(artifacts.get(Artifact.ID.create()))
      expect(Exit.isFailure(missing)).toBe(true)

      const ready = yield* artifacts.update({ id: created.id, status: "ready" })
      expect(ready.version).toBe(2)
      expect(ready.status).toBe("ready")
      expect(ready.timeUpdated).toBeGreaterThanOrEqual(ready.timeCreated)

      const withDiff = yield* artifacts.update({
        id: created.id,
        diff: "--- a/x\n+++ b/x",
        content: "6 of 6 flows passed",
      })
      expect(withDiff.version).toBe(3)
      expect(withDiff.diff).toBe("--- a/x\n+++ b/x")
      expect(withDiff.content).toBe("6 of 6 flows passed")

      const byTask = yield* artifacts.list({ task: "task-crud" })
      expect(byTask.map((row) => row.id)).toEqual([created.id])

      const byType = yield* artifacts.list({ task: "task-crud", type: "BROWSER_RECORDING" })
      expect(byType).toEqual([])

      const bySession = yield* artifacts.list({ sessionID: sessionB })
      expect(bySession.some((row) => row.id === created.id)).toBe(false)
    }),
  )

  it.effect("steers human comments back to the linked session as actionable context", () =>
    Effect.gen(function* () {
      yield* setup
      wakeCalls.length = 0
      const artifacts = yield* Artifact.Service
      const { db } = yield* Database.Service

      const created = yield* artifacts.create(seed({ sessionID: sessionA, task: "task-deliver" }))
      const before = (yield* db.select().from(SessionInputTable).all().pipe(Effect.orDie)).length

      const result = yield* artifacts.comment({
        id: created.id,
        author: "ana",
        body: "The screenshot shows a broken header; fix the CSS before approval.",
      })

      expect(result.delivered).toBe(true)
      expect(result.comment.id).toStartWith("cmt_")
      expect(result.comment.author).toBe("ana")
      expect(wakeCalls).toEqual([sessionA])

      const rows = yield* db.select().from(SessionInputTable).all().pipe(Effect.orDie)
      expect(rows.length).toBe(before + 1)
      const row = rows.at(-1)
      expect(row?.session_id).toBe(sessionA)
      expect(row?.delivery).toBe("steer")
      expect(row?.prompt.text).toContain("ana")
      expect(row?.prompt.text).toContain("broken header")
      expect(row?.prompt.text).toContain("artifact for task-deliver")

      const fetched = yield* artifacts.get(created.id)
      expect(fetched.comments).toHaveLength(1)
      expect(fetched.comments[0]?.body).toBe("The screenshot shows a broken header; fix the CSS before approval.")
    }),
  )

  it.effect("keeps comments stored without delivery when no session is linked", () =>
    Effect.gen(function* () {
      yield* setup
      wakeCalls.length = 0
      const artifacts = yield* Artifact.Service
      const { db } = yield* Database.Service

      const linked = yield* artifacts.create(seed({ sessionID: sessionA, task: "task-undelivered" }))

      // The session disappears after creation: the FK clears the link, and the
      // comment must survive while delivery honestly reports false.
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionA)).run().pipe(Effect.orDie)
      const relinked = yield* artifacts.get(linked.id)
      expect(relinked.sessionID).toBeUndefined()

      // Count after the cascade delete, so the assertion only sees this comment.
      const before = (yield* db.select().from(SessionInputTable).all().pipe(Effect.orDie)).length
      const result = yield* artifacts.comment({ id: linked.id, author: "bruno", body: "Please split the diff." })
      expect(result.delivered).toBe(false)
      expect(wakeCalls).toEqual([])

      const rows = yield* db.select().from(SessionInputTable).all().pipe(Effect.orDie)
      expect(rows.length).toBe(before)
      const fetched = yield* artifacts.get(linked.id)
      expect(fetched.comments).toHaveLength(1)
      expect(fetched.comments[0]?.author).toBe("bruno")
    }),
  )

  it.effect("rejects comments on unknown artifacts and creation with a missing session", () =>
    Effect.gen(function* () {
      yield* setup
      const artifacts = yield* Artifact.Service

      const commentExit = yield* Effect.exit(
        artifacts.comment({ id: Artifact.ID.create(), author: "ana", body: "orphan" }),
      )
      expect(Exit.isFailure(commentExit)).toBe(true)

      const createExit = yield* Effect.exit(artifacts.create(seed({ sessionID: sessionGone, task: "task-missing" })))
      expect(Exit.isFailure(createExit)).toBe(true)
    }),
  )
})
