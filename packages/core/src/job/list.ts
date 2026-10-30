export * as JobList from "./list.js"

import { Job } from "@opencode/schema/job"
import { asc } from "drizzle-orm"
import { Effect, Schema, SynchronizedRef } from "effect"
import type { Database } from "../database/database.js"
import { type Info, type Recovery, RecoverySchema } from "../job.js"
import { JobTable } from "./sql.js"

export type Item = Job.Info

export type Live = {
  readonly info: Info
  readonly isBackgrounded: boolean
  readonly recovery?: Recovery
}

function toItem(input: {
  readonly id: string
  readonly status: Job.Status
  readonly title?: string | null
  readonly started: number
  readonly completed?: number
  readonly recovery: Recovery
}): Job.Info {
  const title = input.title ?? undefined
  const time: Job.Time = {
    started: input.started,
    ...(input.completed !== undefined ? { completed: input.completed } : {}),
  }
  const recovery = input.recovery
  if (recovery.kind === "shell") {
    return {
      kind: "shell",
      id: input.id,
      sessionID: recovery.sessionID,
      status: input.status,
      ...(title !== undefined ? { title } : {}),
      time,
      shellID: recovery.shellID,
      command: recovery.command,
    }
  }
  if (recovery.kind === "subagent") {
    return {
      kind: "subagent",
      id: input.id,
      sessionID: recovery.parentSessionID,
      status: input.status,
      ...(title !== undefined ? { title } : {}),
      time,
      childSessionID: recovery.childSessionID,
      agent: recovery.agent,
      description: recovery.description,
    }
  }
  return {
    kind: "image",
    id: input.id,
    sessionID: recovery.sessionID,
    status: input.status,
    ...(title !== undefined ? { title } : {}),
    time,
    path: recovery.path,
    model: recovery.model,
  }
}

export function read<Entry extends Live>(
  db: Database.Interface["db"],
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Entry>>,
): Effect.Effect<readonly Job.Info[]> {
  const decodeRecovery = Schema.decodeUnknownOption(RecoverySchema)
  return Effect.gen(function* () {
    const [rows, active] = yield* Effect.all([
      db
        .select()
        .from(JobTable)
        .orderBy(asc(JobTable.time_created), asc(JobTable.notification_id))
        .all()
        .pipe(Effect.orDie),
      SynchronizedRef.get(jobs),
    ])
    const seen = new Set<string>()
    const items: Job.Info[] = []
    for (const row of rows) {
      const recovery = decodeRecovery(row.recovery)
      if (recovery._tag === "None") continue
      seen.add(row.notification_id)
      const live = active.get(row.id)
      const sameGeneration = live?.info.notificationID === row.notification_id
      const status = sameGeneration ? live.info.status : row.status
      const completed = sameGeneration
        ? live.info.completed_at
        : row.status !== "running"
          ? row.time_updated
          : undefined
      items.push(
        toItem({
          id: row.id,
          status,
          title: sameGeneration && live.info.title !== undefined ? live.info.title : row.title,
          started: row.time_created,
          completed,
          recovery: recovery.value,
        }),
      )
    }
    for (const live of active.values()) {
      if (!live.isBackgrounded || !live.recovery) continue
      if (live.info.notificationID && seen.has(live.info.notificationID)) continue
      items.push(
        toItem({
          id: live.info.id,
          status: live.info.status,
          title: live.info.title,
          started: live.info.started_at,
          completed: live.info.completed_at,
          recovery: live.recovery,
        }),
      )
    }
    return items
  }).pipe(Effect.withSpan("Job.backgroundJobs"))
}
