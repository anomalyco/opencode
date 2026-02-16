import z from "zod"
import { Database, desc, eq, lt } from "@/storage/db"
import { Config } from "@/config/config"
import { Scheduler } from "@/scheduler"
import { TaskMetricsTable } from "./graph.sql"

export namespace TaskMetrics {
  const DAY_MS = 24 * 60 * 60 * 1000

  export const Row = z
    .object({
      id: z.string(),
      session_id: z.string(),
      task_id: z.string(),
      duration: z.number().int(),
      tokens_used: z.number().int(),
      attempts: z.number().int(),
      success: z.number().int(),
      complexity: z.string(),
      skills_used: z.array(z.string()).nullable().optional(),
      type: z.string(),
      time_created: z.number().int(),
    })
    .meta({ ref: "TaskMetrics" })

  export type Row = z.infer<typeof Row>

  export function list(sessionID: string, input?: { limit?: number }) {
    const limit = input?.limit
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new Error("limit must be a positive integer")
    }

    return Database.use((db) =>
      db
        .select()
        .from(TaskMetricsTable)
        .where(eq(TaskMetricsTable.session_id, sessionID))
        .orderBy(desc(TaskMetricsTable.time_created))
        .limit(limit ?? 1000)
        .all(),
    )
  }

  export function init() {
    Scheduler.register({
      id: "task_metrics.cleanup",
      interval: DAY_MS,
      run: cleanup,
      scope: "global",
    })
  }

  export async function cleanup() {
    const cfg = await Config.get()
    if (cfg.experimental?.task_metrics === false) return
    const days = cfg.experimental?.task_metrics_retention_days ?? 30
    const cutoff = Date.now() - days * DAY_MS
    Database.use((db) => db.delete(TaskMetricsTable).where(lt(TaskMetricsTable.time_created, cutoff)).run())
  }
}
