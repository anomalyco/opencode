import { Context, Duration, Effect, Layer, Scope, Schedule } from "effect"
import { Database } from "../database/database"
import { PersonalWatchersTable } from "./sql"
import { eq, desc } from "drizzle-orm"
import { Identifier } from "../util/identifier"
import fs from "fs/promises"

export interface WatcherEntry {
  id: string
  name: string
  type: string
  target: string
  condition: string | null
  action: any
  active: number
  last_triggered: number | null
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly create: (name: string, type: string, target: string, condition?: string, action?: any) => Effect.Effect<WatcherEntry>
  readonly list: () => Effect.Effect<WatcherEntry[]>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly checkAll: () => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Watcher") {}

function parseWatcherRow(row: any): WatcherEntry {
  let action: any = null
  try {
    action = row.action ? JSON.parse(row.action) : null
  } catch {}
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    target: row.target,
    condition: row.condition,
    action,
    active: row.active ?? 0,
    last_triggered: row.last_triggered,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service
  const scope = yield* Scope.Service

  const list = Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(PersonalWatchersTable)
      .orderBy(desc(PersonalWatchersTable.time_created))
      .all()
      .pipe(Effect.orDie)
    return rows.map(parseWatcherRow)
  })

  const checkWatcher = (watcher: WatcherEntry) =>
    Effect.gen(function* () {
      const now = Date.now()
      let triggered = false
      switch (watcher.type) {
        case "file": {
          try {
            const stat = yield* Effect.promise(() => fs.stat(watcher.target))
            if (watcher.last_triggered && stat.mtimeMs > watcher.last_triggered) triggered = true
          } catch {}
          break
        }
        case "process": {
          const childProc = yield* Effect.promise(() => import("child_process"))
          const out = yield* Effect.promise(
            () =>
              new Promise<string>((resolve) =>
                childProc.exec(`pgrep -f "${watcher.target.replace(/"/g, '\\"')}"`, (_, stdout) =>
                  resolve(stdout.trim()),
                ),
              ),
          )
          triggered = out.length > 0
          break
        }
        case "url": {
          try {
            const res = yield* Effect.promise(() =>
              fetch(watcher.target, { method: "HEAD", signal: AbortSignal.timeout(10000) }),
            )
            triggered = res.ok
          } catch {}
          break
        }
        case "command": {
          const childProc = yield* Effect.promise(() => import("child_process"))
          const out = yield* Effect.promise(
            () =>
              new Promise<string>((resolve) =>
                childProc.exec(watcher.target, (_, stdout) => resolve(stdout.trim())),
              ),
          )
          triggered = out.length > 0
          break
        }
        case "system": {
          triggered = true
          break
        }
      }
      if (triggered) {
        yield* db
          .update(PersonalWatchersTable)
          .set({ last_triggered: now, time_updated: now })
          .where(eq(PersonalWatchersTable.id, watcher.id))
          .run()
          .pipe(Effect.orDie)
        if (watcher.action) {
          yield* Effect.log(`Watcher "${watcher.name}" triggered`)
        }
      }
    })

  const svc = Service.of({
    create: (name, type, target, condition, action) =>
      Effect.gen(function* () {
        const id = "wtr_" + Identifier.ascending()
        const now = Date.now()
        const row = {
          id,
          name,
          type,
          target,
          condition: condition ?? null,
          action: action ? JSON.stringify(action) : null,
          active: 1,
          last_triggered: null,
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(PersonalWatchersTable).values(row).pipe(Effect.orDie)
        return {
          id,
          name,
          type,
          target,
          condition: condition ?? null,
          action: action ?? null,
          active: 1,
          last_triggered: null,
          time_created: now,
          time_updated: now,
        }
      }),
    list,
    delete: (id) =>
      Effect.gen(function* () {
        yield* db
          .delete(PersonalWatchersTable)
          .where(eq(PersonalWatchersTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    checkAll: Effect.gen(function* () {
      const watchers = yield* list
      const active = watchers.filter((w) => w.active)
      yield* Effect.forEach(active, (w) => checkWatcher(w), { concurrency: 5 })
    }),
  })

  yield* Effect.forkScoped(
    Effect.repeat(
      Effect.gen(function* () {
        yield* svc.checkAll
      }),
      Schedule.fixed(Duration.seconds(60)),
    ),
  )

  return svc
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as Watcher }
