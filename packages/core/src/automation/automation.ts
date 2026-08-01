export * as Automation from "./automation"

import { DateTime, Effect, Layer, Schema, Context } from "effect"
import { and, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { SessionV2 } from "../session"
import { SessionInput } from "../session/input"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionExecution } from "../session/execution"
import { AutomationTriggerTable, type Schedule } from "./sql"
import { makeGlobalNode } from "../effect/app-node"

export type { Schedule }

export interface Trigger {
  readonly id: string
  readonly sessionID: SessionSchema.ID
  readonly name: string
  readonly prompt: string
  readonly schedule: Schedule
  readonly enabled: boolean
  readonly agent?: string
  readonly lastFired?: number
  readonly timeCreated: number
  readonly timeUpdated: number
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Automation.NotFoundError", {
  id: Schema.String,
}) {}

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "Automation.SessionNotFoundError",
  { sessionID: SessionSchema.ID },
) {}

export type Error = NotFoundError

const fromRow = (row: typeof AutomationTriggerTable.$inferSelect): Trigger => ({
  id: row.id,
  sessionID: SessionSchema.ID.make(row.session_id),
  name: row.name,
  prompt: row.prompt,
  schedule: row.schedule,
  enabled: row.enabled,
  ...(row.agent ? { agent: row.agent } : {}),
  ...(row.last_fired ? { lastFired: row.last_fired } : {}),
  timeCreated: row.time_created,
  timeUpdated: row.time_updated,
})

export interface Interface {
  readonly create: (input: {
    id?: string
    sessionID: SessionSchema.ID
    name: string
    prompt: string
    schedule: Schedule
    enabled?: boolean
    agent?: string
  }) => Effect.Effect<Trigger, never>
  readonly get: (id: string) => Effect.Effect<Trigger, NotFoundError>
  readonly list: (input?: { sessionID?: SessionSchema.ID }) => Effect.Effect<Trigger[], never>
  readonly update: (
    id: string,
    patch: Partial<{ name: string; prompt: string; enabled: boolean; agent: string }>,
  ) => Effect.Effect<Trigger, NotFoundError>
  readonly remove: (id: string) => Effect.Effect<boolean, never>
  readonly fire: (id: string) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Automation") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const session = yield* SessionV2.Service
    const execution = yield* SessionExecution.Service

    return Service.of({
      create: Effect.fn("Automation.create")(function* (input) {
        const id = input.id ?? crypto.randomUUID()
        const now = Date.now()
        yield* db
          .insert(AutomationTriggerTable)
          .values({
            id,
            session_id: input.sessionID,
            name: input.name,
            prompt: input.prompt,
            schedule: input.schedule,
            enabled: input.enabled ?? true,
            ...(input.agent ? { agent: input.agent } : {}),
            last_fired: null,
            time_created: now,
            time_updated: now,
          })
          .pipe(Effect.orDie)
        const row = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        return fromRow(row!)
      }),

      get: Effect.fn("Automation.get")(function* (id) {
        const row = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ id })
        return fromRow(row)
      }),

      list: Effect.fn("Automation.list")(function* (input) {
        const query = db.select().from(AutomationTriggerTable)
        const rows = yield* (input?.sessionID
          ? query.where(eq(AutomationTriggerTable.session_id, input.sessionID))
          : query
        ).pipe(Effect.orDie)
        return rows.map(fromRow)
      }),

      update: Effect.fn("Automation.update")(function* (id, patch) {
        const existing = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!existing) return yield* new NotFoundError({ id })
        const updates: Record<string, unknown> = { time_updated: Date.now() }
        if (patch.name !== undefined) updates.name = patch.name
        if (patch.prompt !== undefined) updates.prompt = patch.prompt
        if (patch.enabled !== undefined) updates.enabled = patch.enabled
        if (patch.agent !== undefined) updates.agent = patch.agent
        yield* db.update(AutomationTriggerTable).set(updates).where(eq(AutomationTriggerTable.id, id)).pipe(Effect.orDie)
        const row = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        return fromRow(row!)
      }),

      remove: Effect.fn("Automation.remove")(function* (id) {
        const existing = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!existing) return false
        yield* db.delete(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).run().pipe(Effect.orDie)
        return true
      }),

      fire: Effect.fn("Automation.fire")(function* (id) {
        const trigger = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!trigger) return yield* new NotFoundError({ id })

        yield* session
          .prompt({
            id: SessionMessage.ID.make(`auto_${id}_${Date.now()}`),
            sessionID: SessionSchema.ID.make(trigger.session_id),
            prompt: PromptInput.Prompt.make({ text: trigger.prompt }),
            delivery: "steer",
          })
          .pipe(Effect.ignore)

        yield* db
          .update(AutomationTriggerTable)
          .set({ last_fired: Date.now(), time_updated: Date.now() })
          .where(eq(AutomationTriggerTable.id, id))
          .pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, SessionV2.node, SessionExecution.node] })
