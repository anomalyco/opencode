import { Effect, Layer, ServiceMap } from "effect"
import { Database, eq, and, desc } from "../../storage/db"
import { MemoryProjectTable } from "../session.sql"
import { Log } from "@/util/log"
import type { ExtractionResult, MemoryProject } from "./types"
import { makeRuntime } from "@/effect/run-service"

export namespace ProjectTracker {
  const log = Log.create({ service: "memory.project-tracker" })

  export interface Interface {
    readonly track: (input: {
      extraction: ExtractionResult
      windowID: string
      projectID: string
    }) => Effect.Effect<void>
    readonly getActive: (projectID: string) => Effect.Effect<MemoryProject[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ProjectTracker") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const track = Effect.fn("ProjectTracker.track")(function* (input: {
        extraction: ExtractionResult
        windowID: string
        projectID: string
      }) {
        const goal = input.extraction.goal ?? ""
        const key = goal
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-+|-+$)/g, "")
          .slice(0, 50)
        if (!key) return

        const now = Date.now()

        const existing = Database.use((d) =>
          d
            .select()
            .from(MemoryProjectTable)
            .where(
              and(
                eq(MemoryProjectTable.project_id, input.projectID),
                eq(MemoryProjectTable.project_key, key),
              ),
            )
            .all(),
        )

        if (existing.length > 0) {
          const proj = existing[0]
          const inProgress = input.extraction.in_progress?.length ?? 0
          const accomplished = input.extraction.accomplished?.length ?? 0
          const status = accomplished && !inProgress ? "done" : inProgress ? "in_progress" : proj.status

          const windowIds = [...(proj.source_window_ids ?? []), input.windowID]

          Database.use((d) =>
            d
              .update(MemoryProjectTable)
              .set({
                status,
                summary: goal,
                latest_progress: input.extraction.in_progress?.join("; ") ?? null,
                blockers: input.extraction.blocked_on?.join("; ") ?? null,
                source_window_ids: [...new Set(windowIds)],
                time_updated: now,
              })
              .where(eq(MemoryProjectTable.id, proj.id))
              .run(),
          )

          log.info("updated project", { key, status })
          return
        }

        const inProgress = input.extraction.in_progress?.length ?? 0
        const status = inProgress ? "in_progress" : "planned"

        Database.use((d) =>
          d
            .insert(MemoryProjectTable)
            .values({
              id: crypto.randomUUID(),
              project_id: input.projectID,
              project_key: key,
              project_name: goal.slice(0, 100),
              status,
              summary: goal,
              latest_progress: input.extraction.in_progress?.join("; ") ?? null,
              blockers: input.extraction.blocked_on?.join("; ") ?? null,
              source_window_ids: [input.windowID],
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        log.info("created project", { key, status })
      })

      const getActive = Effect.fn("ProjectTracker.getActive")(function* (projectID: string) {
        return Database.use((d) =>
          d
            .select()
            .from(MemoryProjectTable)
            .where(
              and(
                eq(MemoryProjectTable.project_id, projectID),
                eq(MemoryProjectTable.status, "in_progress"),
              ),
            )
            .orderBy(desc(MemoryProjectTable.time_updated))
            .all(),
        )
      })

      return Service.of({ track, getActive })
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function track(input: {
    extraction: ExtractionResult
    windowID: string
    projectID: string
  }) {
    return runPromise((svc) => svc.track(input))
  }

  export async function getActive(projectID: string) {
    return runPromise((svc) => svc.getActive(projectID))
  }
}
