import { Context, Effect, Layer, Scope } from "effect"
import { Database } from "../database/database"
import { ScheduleTable } from "./sql"
import { eq, lte, and } from "drizzle-orm"
import { Identifier } from "../util/identifier"
import { parseCronOrDuration } from "./cron"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Path as GlobalPath } from "../global"

export interface ScheduleEntry {
  id: string
  cron: string
  command: string
  last_run: number | null
  next_run: number
  active: number
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly create: (cron: string, command: string) => Effect.Effect<ScheduleEntry>
  readonly list: () => Effect.Effect<ScheduleEntry[]>
  readonly runPending: () => Effect.Effect<void, never, Scope.Scope>
  readonly deactivate: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Schedule") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const runPending = () =>
      Effect.gen(function* () {
        const now = Date.now()
        // Select active schedules that are due
        const pending = yield* db
          .select()
          .from(ScheduleTable)
          .where(and(eq(ScheduleTable.active, 1), lte(ScheduleTable.next_run, now)))
          .all()
          .pipe(Effect.orDie)

        for (const task of pending) {
          const logPath = path.join(GlobalPath.log, `schedule_task_${task.id}.log`)
          const nextRunDate = parseCronOrDuration(task.cron, new Date())
          const nextRun = nextRunDate.getTime()

          // Update task next run and last run in DB first to avoid double execution
          yield* db
            .update(ScheduleTable)
            .set({
              last_run: now,
              next_run: nextRun,
              time_updated: now,
            })
            .where(eq(ScheduleTable.id, task.id))
            .run()
            .pipe(Effect.orDie)


          // Spawn command asynchronously
          yield* Effect.promise(async () => {
            try {
              const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/sh")
              const args = process.platform === "win32" ? ["/c", task.command] : ["-c", task.command]
              
              // Write a start header to the log file
              await fs.appendFile(logPath, `\n\n--- TASK START: ${new Date().toISOString()} ---\nCommand: ${task.command}\n\n`)

              const proc = spawn(shell, args, {
                env: { ...process.env, LD_PRELOAD: "" }, // Ensure child process doesn't crash on Termux libc mismatch
                stdio: "pipe",
              })

              proc.stdout.on("data", (data) => {
                fs.appendFile(logPath, data).catch(() => {})
              })

              proc.stderr.on("data", (data) => {
                fs.appendFile(logPath, data).catch(() => {})
              })

              proc.on("close", (code) => {
                fs.appendFile(logPath, `\n--- TASK COMPLETED WITH CODE: ${code} ---\n`).catch(() => {})
              })
            } catch (err: any) {
              await fs.appendFile(logPath, `\n--- TASK FAILED TO START: ${err.message} ---\n`).catch(() => {})
            }
          }).pipe(
            Effect.forkScoped,
            Effect.orDie,
          )
        }
      })

    // Start background loop for daemon scheduling
    yield* Effect.gen(function* () {
      while (true) {
        yield* runPending()
        yield* Effect.sleep("10 seconds")
      }
    }).pipe(
      Effect.forkScoped,
      Effect.orDie,
    )

    return Service.of({
      create: (cron, command) =>
        Effect.gen(function* () {
          const id = "sch_" + Identifier.ascending()
          const now = Date.now()
          const nextRunDate = parseCronOrDuration(cron, new Date())
          const nextRun = nextRunDate.getTime()

          const row = {
            id,
            cron,
            command,
            last_run: null,
            next_run: nextRun,
            active: 1,
            time_created: now,
            time_updated: now,
          }

          yield* db.insert(ScheduleTable).values(row).pipe(Effect.orDie)

          return {
            ...row,
          }
        }),

      list: () =>
        Effect.gen(function* () {
          const rows = yield* db.select().from(ScheduleTable).all().pipe(Effect.orDie)
          return rows.map((row) => ({
            id: row.id,
            cron: row.cron,
            command: row.command,
            last_run: row.last_run,
            next_run: row.next_run,
            active: row.active,
            time_created: row.time_created,
            time_updated: row.time_updated,
          }))
        }),

      runPending,

      deactivate: (id) =>
        Effect.gen(function* () {
          const now = Date.now()
          yield* db
            .update(ScheduleTable)
            .set({ active: 0, time_updated: now })
            .where(eq(ScheduleTable.id, id))
            .run()
            .pipe(Effect.orDie)
        }),
    })
  }),
)
