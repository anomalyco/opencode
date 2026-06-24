/**
 * CRUD repository for the monitor module.
 *
 * The actual tables live in `./monitor.sql.ts`. This file is a thin
 * Drizzle wrapper so route handlers don't have to repeat the SQL and
 * timestamp gymnastics. All writes set `time_created` and `time_updated`
 * automatically and generate IDs via the same `Identifier` scheme other
 * opencode services use.
 */

import { Database, eq, desc } from "@/storage"
import * as Identifier from "@/id/id"
import { Effect } from "effect"
import {
  AlertChannelTable,
  AlertRuleTable,
  AlertEventTable,
  type AlertRule,
  type AlertEvent,
  type AlertChannel,
} from "./monitor.sql"
import { Condition, AlertRule as AlertRuleSchema } from "./alerts"
import { ChannelPublicSchema, ChannelWriteSchema } from "./channels"

// --- Channels -------------------------------------------------------------

const SECRET_MASK = "***"

export function maskSecrets(channel: AlertChannel): AlertChannel {
  const masked: AlertChannel = {
    ...channel,
    secret: channel.secret ? SECRET_MASK : null,
  }
  const provider = getProviderPublic(channel)
  const maskedCreds: Record<string, string> = {}
  for (const field of provider.credentialFields) {
    const value = channel.credentials[field.key]
    if (value) maskedCreds[field.key] = field.secret ? SECRET_MASK : value
  }
  return { ...masked, credentials: maskedCreds }
}

import { getProvider } from "./webhook"
import { z } from "zod"

function getProviderPublic(channel: AlertChannel) {
  const id = channel.type as Parameters<typeof getProvider>[0]
  return getProvider(id)
}

export const listChannels = Effect.fn(function* () {
  return Database.use((db) =>
    db
      .select()
      .from(AlertChannelTable)
      .orderBy(desc(AlertChannelTable.time_created))
      .all()
      .map(maskSecrets),
  )
})

export const createChannel = Effect.fn(function* (input: z.infer<typeof ChannelWriteSchema>) {
  const id = Identifier.ascending("channel")
  const now = Date.now()
  const row: AlertChannel = {
    id,
    project_id: input.project_id,
    type: input.type,
    name: input.name,
    url: input.url ?? null,
    credentials: input.credentials ?? {},
    secret: input.secret ?? null,
    enabled: input.enabled ?? true,
    time_created: now,
    time_updated: now,
  }
  Database.use((db) => db.insert(AlertChannelTable).values(row).run())
  return maskSecrets(row)
})

export const updateChannel = Effect.fn(function* (id: string, patch: z.infer<typeof ChannelWriteSchema>) {
  const now = Date.now()
  Database.use((db) =>
    db
      .update(AlertChannelTable)
      .set({
        type: patch.type,
        name: patch.name,
        url: patch.url ?? null,
        credentials: patch.credentials ?? {},
        secret: patch.secret ?? null,
        enabled: patch.enabled ?? true,
        time_updated: now,
      })
      .where(eq(AlertChannelTable.id, id))
      .run(),
  )
  const next = Database.use((db) => db.select().from(AlertChannelTable).where(eq(AlertChannelTable.id, id)).get())
  return next ? maskSecrets(next) : null
})

export const deleteChannel = Effect.fn(function* (id: string) {
  Database.use((db) => db.delete(AlertChannelTable).where(eq(AlertChannelTable.id, id)).run())
})

export const getChannelRaw = Effect.fn(function* (id: string) {
  return Database.use((db) =>
    db.select().from(AlertChannelTable).where(eq(AlertChannelTable.id, id)).get() ?? null,
  )
})

// --- Rules ----------------------------------------------------------------

export const listRules = Effect.fn(function* () {
  return Database.use((db) =>
    db
      .select()
      .from(AlertRuleTable)
      .orderBy(desc(AlertRuleTable.time_created))
      .all() as AlertRule[],
  )
})

export const createRule = Effect.fn(function* (input: {
  project_id: string
  name: string
  type: AlertRule["type"]
  condition: z.infer<typeof Condition>
  cooldown_sec?: number
  enabled?: boolean
}) {
  const id = Identifier.ascending("rule")
  const now = Date.now()
  const row: AlertRule = {
    id,
    project_id: input.project_id,
    name: input.name,
    type: input.type,
    condition: input.condition,
    cooldown_sec: input.cooldown_sec ?? 300,
    enabled: input.enabled ?? true,
    time_created: now,
    time_updated: now,
  }
  Database.use((db) => db.insert(AlertRuleTable).values(row).run())
  return row
})

export const deleteRule = Effect.fn(function* (id: string) {
  Database.use((db) => db.delete(AlertRuleTable).where(eq(AlertRuleTable.id, id)).run())
})

// --- Events ---------------------------------------------------------------

export const listEvents = Effect.fn(function* () {
  return Database.use((db) =>
    db
      .select()
      .from(AlertEventTable)
      .orderBy(desc(AlertEventTable.time_created))
      .limit(200)
      .all() as AlertEvent[],
  )
})

export const ackEvent = Effect.fn(function* (id: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .update(AlertEventTable)
      .set({ status: "acked", acked_at: now, time_updated: now })
      .where(eq(AlertEventTable.id, id))
      .run(),
  )
})

export const recordEvent = Effect.fn(function* (input: {
  rule_id: string
  session_id: string | null
  payload: Record<string, unknown>
}) {
  const id = Identifier.ascending("event")
  const now = Date.now()
  const row: AlertEvent = {
    id,
    rule_id: input.rule_id,
    session_id: input.session_id,
    payload: input.payload,
    status: "fired",
    time_created: now,
    time_updated: now,
    acked_at: null,
  }
  Database.use((db) => db.insert(AlertEventTable).values(row).run())
  return row
})

// Re-export schemas so route handlers have a single import target.
export { AlertRuleSchema as AlertRule }
export { ChannelPublicSchema as AlertChannelPublic }