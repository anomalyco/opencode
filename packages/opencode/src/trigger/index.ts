import { randomUUID } from "node:crypto"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import type { ProjectID } from "@/project/schema"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"
import { TriggerTable } from "@/session/session.sql"
import { Database, NotFoundError, eq } from "@/storage/db"
import { Cause, Duration, Effect, Layer, Schedule, ServiceMap } from "effect"
import z from "zod"
import { Log } from "../util/log"

export namespace Trigger {
  const log = Log.create({ service: "trigger" })

  const Action = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("command"),
      sessionID: SessionID.zod,
      command: z.string(),
      arguments: z.string().optional(),
    }),
  ])

  const Source = z.enum(["schedule", "manual", "webhook"])
  type Source = z.infer<typeof Source>

  const Status = z.enum(["success", "skipped", "failed"])
  const Last = z.object({
    source: Source,
    status: Status,
    error: z.string().min(1).optional(),
    time: z.number().int().nonnegative(),
  })
  type Last = z.infer<typeof Last>

  export const Info = z
    .object({
      id: z.string(),
      schedule: z.object({
        type: z.literal("interval"),
        interval: z.number().int().positive(),
      }),
      action: Action.optional(),
      webhook_secret: z.string().min(1).optional(),
      enabled: z.boolean(),
      runs: z.number().int().nonnegative(),
      last: Last.optional(),
      time: z.object({
        created: z.number().int().nonnegative(),
        last: z.number().int().nonnegative().optional(),
        next: z.number().int().nonnegative(),
      }),
    })
    .meta({
      ref: "Trigger",
    })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    interval: z.number().int().min(10).max(86_400_000),
    action: Action.optional(),
    webhook_secret: z.string().min(1).optional(),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  export const Event = {
    Fired: BusEvent.define(
      "trigger.fired",
      z.object({
        triggerID: z.string(),
        runs: z.number().int().nonnegative(),
        at: z.number().int().nonnegative(),
      }),
    ),
  }

  type Err = InstanceType<typeof NotFoundError>

  type State = {
    create: (input: CreateInput) => Effect.Effect<Info>
    get: (id: string) => Effect.Effect<Info, Err>
    list: () => Effect.Effect<Info[]>
    fire: (id: string, source: Source) => Effect.Effect<Info, Err>
    enable: (id: string) => Effect.Effect<Info, Err>
    disable: (id: string) => Effect.Effect<Info, Err>
    delete: (id: string) => Effect.Effect<void, Err>
  }

  export interface Interface {
    readonly create: (input: CreateInput) => Effect.Effect<Info>
    readonly get: (id: string) => Effect.Effect<Info, Err>
    readonly list: () => Effect.Effect<Info[]>
    readonly fire: (id: string, source?: Source) => Effect.Effect<Info, Err>
    readonly enable: (id: string) => Effect.Effect<Info, Err>
    readonly disable: (id: string) => Effect.Effect<Info, Err>
    readonly delete: (id: string) => Effect.Effect<void, Err>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Trigger") {}

  const row = (project_id: ProjectID, item: Info, time_updated = Date.now()): typeof TriggerTable.$inferInsert => ({
    id: item.id,
    project_id,
    schedule: item.schedule,
    action: item.action ?? null,
    webhook_secret: item.webhook_secret ?? null,
    enabled: item.enabled,
    runs: item.runs,
    last_source: item.last?.source ?? null,
    last_status: item.last?.status ?? null,
    last_error: item.last?.error ?? null,
    time_created: item.time.created,
    time_updated,
    time_last: item.last?.time ?? item.time.last ?? null,
    time_next: item.time.next,
  })

  const from = (row: typeof TriggerTable.$inferSelect): Info => ({
    id: row.id,
    schedule: row.schedule,
    ...(row.action ? { action: row.action } : {}),
    ...(row.webhook_secret ? { webhook_secret: row.webhook_secret } : {}),
    enabled: row.enabled,
    runs: row.runs,
    ...(row.last_source && row.last_status && row.time_last !== null
      ? {
          last: {
            source: row.last_source,
            status: row.last_status,
            ...(row.last_error ? { error: row.last_error } : {}),
            time: row.time_last,
          },
        }
      : {}),
    time: {
      created: row.time_created,
      ...(row.time_last === null ? {} : { last: row.time_last }),
      next: row.time_next,
    },
  })

  const ensure = Effect.sync(() => {
    Database.Client()
      .$client.query(
        `
      CREATE TABLE IF NOT EXISTS trigger (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        schedule text NOT NULL,
        action text,
        webhook_secret text,
        enabled integer NOT NULL,
        runs integer NOT NULL,
        time_created integer NOT NULL,
        time_updated integer NOT NULL,
        time_last integer,
        time_next integer NOT NULL
      )
    `,
      )
      .run()
    const cols = Database.Client().$client.query(`PRAGMA table_info(trigger)`).all() as { name: string }[]
    if (!cols.some((col) => col.name === "webhook_secret")) {
      Database.Client().$client.query(`ALTER TABLE trigger ADD COLUMN webhook_secret text`).run()
    }
    if (!cols.some((col) => col.name === "last_source")) {
      Database.Client().$client.query(`ALTER TABLE trigger ADD COLUMN last_source text`).run()
    }
    if (!cols.some((col) => col.name === "last_status")) {
      Database.Client().$client.query(`ALTER TABLE trigger ADD COLUMN last_status text`).run()
    }
    if (!cols.some((col) => col.name === "last_error")) {
      Database.Client().$client.query(`ALTER TABLE trigger ADD COLUMN last_error text`).run()
    }
    Database.Client().$client.query(`CREATE INDEX IF NOT EXISTS trigger_project_idx ON trigger (project_id)`).run()
  })

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("Trigger.state")(function* (ctx) {
          yield* ensure
          const data = new Map(
            Database.use((db) =>
              db
                .select()
                .from(TriggerTable)
                .where(eq(TriggerTable.project_id, ctx.project.id))
                .all()
                .map((row) => [row.id, from(row)] as const),
            ),
          )

          const save = Effect.fnUntraced(function* (next: Info) {
            yield* Effect.sync(() =>
              Database.use((db) =>
                db
                  .insert(TriggerTable)
                  .values(row(ctx.project.id, next))
                  .onConflictDoUpdate({
                    target: TriggerTable.id,
                    set: row(ctx.project.id, next),
                  })
                  .run(),
              ),
            )
          })

          const delrow = Effect.fnUntraced(function* (id: string) {
            yield* Effect.sync(() => Database.use((db) => db.delete(TriggerTable).where(eq(TriggerTable.id, id)).run()))
          })

          const get = Effect.fn("Trigger.get")((id: string) =>
            Effect.sync(() => {
              const item = data.get(id)
              if (item !== undefined) return item
              throw new NotFoundError({ message: `Trigger not found: ${id}` })
            }),
          )

          const last = Effect.fnUntraced(function* (item: Info, next: Last) {
            const out = {
              ...item,
              last: next,
              time: {
                ...item.time,
                last: next.time,
              },
            }
            data.set(item.id, out)
            yield* save(out)
            return out
          })

          const run = Effect.fnUntraced(function* (item: Info, source: Source) {
            const at = Date.now()
            const next = {
              ...item,
              runs: item.runs + 1,
              time: {
                ...item.time,
                last: at,
                next: at + item.schedule.interval,
              },
            }
            data.set(item.id, next)
            yield* save(next)
            yield* bus.publish(Event.Fired, {
              triggerID: item.id,
              runs: next.runs,
              at,
            })
            const action = item.action
            if (!action) return yield* last(next, { source, status: "success", time: at })
            const st = yield* Effect.promise(() => SessionStatus.get(action.sessionID))
            if (st.type !== "idle") return yield* last(next, { source, status: "skipped", time: at })
            return yield* Effect.promise(() =>
              SessionPrompt.command({
                sessionID: action.sessionID,
                command: action.command,
                arguments: action.arguments ?? "",
              }),
            ).pipe(
              Effect.flatMap(() => last(next, { source, status: "success", time: at })),
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  const err = Cause.squash(cause)
                  yield* Effect.sync(() =>
                    log.error("trigger action failed", {
                      triggerID: item.id,
                      cause: Cause.pretty(cause),
                    }),
                  )
                  return yield* last(next, {
                    source,
                    status: "failed",
                    error: err instanceof Error ? err.message : String(err),
                    time: at,
                  })
                }),
              ),
            )
          })

          const tick = Effect.fnUntraced(function* () {
            yield* Effect.forEach(
              Array.from(data.values()).filter((item) => item.enabled && item.time.next <= Date.now()),
              (item) => run(item, "schedule"),
              { discard: true },
            )
          })

          yield* tick().pipe(
            Effect.catchCause((cause) => {
              log.error("tick loop failed", { cause: Cause.pretty(cause) })
              return Effect.void
            }),
            Effect.repeat(Schedule.spaced(Duration.millis(10))),
            Effect.forkScoped,
          )

          const create = Effect.fn("Trigger.create")(function* (input: CreateInput) {
            const now = Date.now()
            const item = {
              id: `trg_${randomUUID().replaceAll("-", "")}`,
              schedule: {
                type: "interval" as const,
                interval: input.interval,
              },
              action: input.action,
              webhook_secret: input.webhook_secret,
              enabled: true,
              runs: 0,
              time: {
                created: now,
                next: now + input.interval,
              },
            } satisfies Info
            data.set(item.id, item)
            yield* save(item)
            return item
          })

          const update = Effect.fnUntraced(function* (id: string, enabled: boolean) {
            const item = yield* get(id)
            const next = { ...item, enabled }
            data.set(id, next)
            yield* save(next)
            return next
          })

          const list = Effect.fn("Trigger.list")(() =>
            Effect.succeed(Array.from(data.values()).sort((a, b) => a.time.created - b.time.created)),
          )

          const fire = Effect.fn("Trigger.fire")(function* (id: string, source: Source) {
            return yield* run(yield* get(id), source)
          })

          const enable = Effect.fn("Trigger.enable")((id: string) => update(id, true))

          const disable = Effect.fn("Trigger.disable")((id: string) => update(id, false))

          const del = Effect.fn("Trigger.delete")(function* (id: string) {
            yield* get(id)
            data.delete(id)
            yield* delrow(id)
          })

          return { create, get, list, fire, enable, disable, delete: del }
        }),
      )

      return Service.of({
        create: Effect.fn("Trigger.create")(function* (input: CreateInput) {
          return yield* InstanceState.useEffect(state, (svc) => svc.create(input))
        }),
        get: Effect.fn("Trigger.get")(function* (id: string) {
          return yield* InstanceState.useEffect(state, (svc) => svc.get(id))
        }),
        list: Effect.fn("Trigger.list")(function* () {
          return yield* InstanceState.useEffect(state, (svc) => svc.list())
        }),
        fire: Effect.fn("Trigger.fire")(function* (id: string, source = "manual") {
          return yield* InstanceState.useEffect(state, (svc) => svc.fire(id, source))
        }),
        enable: Effect.fn("Trigger.enable")(function* (id: string) {
          return yield* InstanceState.useEffect(state, (svc) => svc.enable(id))
        }),
        disable: Effect.fn("Trigger.disable")(function* (id: string) {
          return yield* InstanceState.useEffect(state, (svc) => svc.disable(id))
        }),
        delete: Effect.fn("Trigger.delete")(function* (id: string) {
          return yield* InstanceState.useEffect(state, (svc) => svc.delete(id))
        }),
      })
    }),
  )

  const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function create(input: CreateInput) {
    return runPromise((svc) => svc.create(input))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }

  export async function get(id: string) {
    return runPromise((svc) => svc.get(id))
  }

  export async function enable(id: string) {
    return runPromise((svc) => svc.enable(id))
  }

  export async function fire(id: string, source: Source = "manual") {
    return runPromise((svc) => svc.fire(id, source))
  }

  export async function disable(id: string) {
    return runPromise((svc) => svc.disable(id))
  }

  export async function remove(id: string) {
    return runPromise((svc) => svc["delete"](id))
  }
}
