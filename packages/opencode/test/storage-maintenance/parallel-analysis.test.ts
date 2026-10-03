import { describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { SessionID } from "@opencode-ai/schema/session-id"
import { ParallelStorageAnalysis } from "@/storage-maintenance/parallel-analysis"
import { Effect } from "effect"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

describe("ParallelStorageAnalysis", () => {
  test("analyzes a consistent snapshot with multiple workers and reports progress", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "parallel-analysis.sqlite")
    const phases: string[] = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const sessionID = SessionID.descending("ses_parallel_analysis")
        const messageID = SessionV1.MessageID.ascending("msg_parallel_analysis")
        const base = {
          id: messageID,
          sessionID,
          role: "user" as const,
          time: { created: 1 },
          agent: "before",
          model: { providerID: ProviderV2.ID.make("provider"), modelID: ModelV2.ID.make("model") },
        }
        const latest = { ...base, agent: "after" }
        const { id: _, sessionID: __, ...latestData } = latest
        yield* database.db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: AbsolutePath.make(tmp.path), sandboxes: [] })
          .run()
        yield* database.db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Project.ID.global,
            slug: "parallel-analysis",
            directory: tmp.path,
            title: "parallel analysis",
            version: "test",
          })
          .run()
        yield* database.db
          .insert(MessageTable)
          .values({
            id: messageID,
            session_id: sessionID,
            data: latestData as (typeof MessageTable.$inferInsert)["data"],
          })
          .run()
        yield* database.db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 1 }).run()
        yield* database.db
          .insert(EventTable)
          .values([
            {
              id: EventV2.ID.make("evt_parallel_analysis_before"),
              aggregate_id: sessionID,
              seq: 0,
              type: "message.updated.1",
              data: { info: base },
            },
            {
              id: EventV2.ID.make("evt_parallel_analysis_after"),
              aggregate_id: sessionID,
              seq: 1,
              type: "message.updated.1",
              data: { info: latest },
            },
          ])
          .run()

        return yield* Effect.tryPromise({
          try: (signal) =>
            ParallelStorageAnalysis.analyze(filename, {
              workers: 2,
              signal,
              onProgress: (progress) => phases.push(`${progress.phase}:${progress.workers}`),
            }),
          catch: (cause) => cause,
        })
      }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
    )

    expect(result).toMatchObject({ snapshots: 2, inspected: 1, candidates: 1, malformed: 0 })
    expect(result.payloadBytesReclaimable).toBeGreaterThan(0)
    expect(phases).toContain("snapshot:1")
    expect(phases).toContain("index:1")
    expect(phases).toContain("analyze:2")
    expect(Array.fromAsync(new Bun.Glob("*.analyze-*.db*").scan(tmp.path))).resolves.toEqual([])
  }, 30_000)

  test("aborts during snapshot verification and removes temporary files", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "parallel-analysis-abort.sqlite")
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Database.Service
      }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
    )

    const controller = new AbortController()
    const result = ParallelStorageAnalysis.analyze(filename, {
      workers: 8,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === "verify") controller.abort()
      },
    })

    await expect(result).rejects.toMatchObject({ name: "AbortError" })
    expect(Array.fromAsync(new Bun.Glob("*.analyze-*.db*").scan(tmp.path))).resolves.toEqual([])
  }, 30_000)
})
