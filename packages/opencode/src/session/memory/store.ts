import { Effect, Layer, ServiceMap } from "effect"
import { Database, eq, and, desc } from "../../storage/db"
import { MemoryFactTable, MemoryWindowTable, MemoryArtifactTable } from "../session.sql"
import { Log } from "@/util/log"
import type { MemoryFact, MemoryWindow, MemoryArtifact } from "./types"
import { makeRuntime } from "@/effect/run-service"

export namespace MemoryStore {
  const log = Log.create({ service: "memory.store" })

  export interface Interface {
    readonly writeWindow: (window: Omit<MemoryWindow, "time_created" | "time_updated">) => Effect.Effect<void>
    readonly writeFacts: (facts: Array<Omit<MemoryFact, "time_created" | "time_updated">>) => Effect.Effect<void>
    readonly writeArtifacts: (
      artifacts: Array<Omit<MemoryArtifact, "time_created" | "time_updated">>,
    ) => Effect.Effect<void>
    readonly getRecentWindows: (opts: { projectID: string; limit: number }) => Effect.Effect<MemoryWindow[]>
    readonly searchWindows: (query: string, opts: { projectID: string; limit: number }) => Effect.Effect<MemoryWindow[]>
    readonly searchFacts: (query: string, opts: { projectID: string; limit: number }) => Effect.Effect<MemoryFact[]>
    readonly searchArtifacts: (
      query: string,
      opts: { projectID: string; limit: number },
    ) => Effect.Effect<MemoryArtifact[]>
    readonly getDurableFacts: (projectID: string) => Effect.Effect<MemoryFact[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/MemoryStore") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const writeWindow = Effect.fn("MemoryStore.writeWindow")(function* (
        window: Omit<MemoryWindow, "time_created" | "time_updated">,
      ) {
        Database.transaction((tx) => {
          tx.insert(MemoryWindowTable).values(window).run()
          tx.$client.run(
            `INSERT INTO memory_window_fts(id, goal, instructions, discoveries, accomplished, in_progress) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              window.id,
              window.goal,
              window.instructions ?? "",
              window.discoveries ?? "",
              window.accomplished ?? "",
              window.in_progress ?? "",
            ],
          )
        })
        log.info("wrote window", { id: window.id })
      })

      const writeFacts = Effect.fn("MemoryStore.writeFacts")(function* (
        facts: Array<Omit<MemoryFact, "time_created" | "time_updated">>,
      ) {
        if (facts.length === 0) return
        Database.transaction((tx) => {
          for (const fact of facts) {
            tx.insert(MemoryFactTable).values(fact).run()
            tx.run(`INSERT INTO memory_fact_fts(id, subject, value) VALUES (?, ?, ?)`, [
              fact.id,
              fact.subject,
              fact.value,
            ])
          }
        })
        log.info("wrote facts", { count: facts.length })
      })

      const writeArtifacts = Effect.fn("MemoryStore.writeArtifacts")(function* (
        artifacts: Array<Omit<MemoryArtifact, "time_created" | "time_updated">>,
      ) {
        if (artifacts.length === 0) return
        Database.transaction((tx) => {
          for (const artifact of artifacts) {
            tx.insert(MemoryArtifactTable).values(artifact).run()
            tx.run(`INSERT INTO memory_artifact_fts(id, content, file_path) VALUES (?, ?, ?)`, [
              artifact.id,
              artifact.content,
              artifact.file_path ?? "",
            ])
          }
        })
        log.info("wrote artifacts", { count: artifacts.length })
      })

      const getRecentWindows = Effect.fn("MemoryStore.getRecentWindows")(function* (opts: {
        projectID: string
        limit: number
      }) {
        return Database.use((d) =>
          d
            .select()
            .from(MemoryWindowTable)
            .where(eq(MemoryWindowTable.project_id, opts.projectID))
            .orderBy(desc(MemoryWindowTable.ended_at))
            .limit(opts.limit)
            .all(),
        )
      })

      const searchWindows = Effect.fn("MemoryStore.searchWindows")(function* (
        query: string,
        opts: { projectID: string; limit: number },
      ) {
        return Database.use((d) => {
          const escaped = query.replace(/"/g, '""')
          return d.all<MemoryWindow>(
            `SELECT mw.* FROM memory_window mw
             JOIN memory_window_fts fts ON mw.id = fts.id
             WHERE memory_window_fts MATCH ? AND mw.project_id = ?
             ORDER BY mw.ended_at DESC LIMIT ?`,
            [`"${escaped}"`, opts.projectID, opts.limit],
          )
        })
      })

      const searchFacts = Effect.fn("MemoryStore.searchFacts")(function* (
        query: string,
        opts: { projectID: string; limit: number },
      ) {
        return Database.use((d) => {
          const escaped = query.replace(/"/g, '""')
          return d.all<MemoryFact>(
            `SELECT mf.* FROM memory_fact mf
             JOIN memory_fact_fts fts ON mf.id = fts.id
             WHERE memory_fact_fts MATCH ? AND mf.project_id = ?
             ORDER BY mf.confidence DESC LIMIT ?`,
            [`"${escaped}"`, opts.projectID, opts.limit],
          )
        })
      })

      const searchArtifacts = Effect.fn("MemoryStore.searchArtifacts")(function* (
        query: string,
        opts: { projectID: string; limit: number },
      ) {
        return Database.use((d) => {
          const escaped = query.replace(/"/g, '""')
          return d.all<MemoryArtifact>(
            `SELECT ma.* FROM memory_artifact ma
             JOIN memory_artifact_fts fts ON ma.id = fts.id
             WHERE memory_artifact_fts MATCH ? AND ma.project_id = ?
             ORDER BY ma.time_created DESC LIMIT ?`,
            [`"${escaped}"`, opts.projectID, opts.limit],
          )
        })
      })

      const getDurableFacts = Effect.fn("MemoryStore.getDurableFacts")(function* (projectID: string) {
        return Database.use((d) =>
          d
            .select()
            .from(MemoryFactTable)
            .where(and(eq(MemoryFactTable.project_id, projectID), eq(MemoryFactTable.confidence, 100)))
            .all(),
        )
      })

      return Service.of({
        writeWindow,
        writeFacts,
        writeArtifacts,
        getRecentWindows,
        searchWindows,
        searchFacts,
        searchArtifacts,
        getDurableFacts,
      })
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function writeWindow(window: Omit<MemoryWindow, "time_created" | "time_updated">) {
    return runPromise((svc) => svc.writeWindow(window))
  }

  export async function writeFacts(facts: Array<Omit<MemoryFact, "time_created" | "time_updated">>) {
    return runPromise((svc) => svc.writeFacts(facts))
  }

  export async function writeArtifacts(artifacts: Array<Omit<MemoryArtifact, "time_created" | "time_updated">>) {
    return runPromise((svc) => svc.writeArtifacts(artifacts))
  }
}
