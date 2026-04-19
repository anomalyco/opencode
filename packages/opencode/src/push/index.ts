import { base64Encode } from "@opencode-ai/shared/util/encode"
import { Slug } from "@opencode-ai/shared/util/slug"
import { Log } from "@/util"
import { Flag } from "@/flag/flag"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Database, asc, desc, eq, lte } from "@/storage"
import { SessionTable } from "@/session/session.sql"
import { PushDeliveryTable, PushSubscriptionTable } from "./push.sql"
import webpush from "web-push"
import z from "zod"

const log = Log.create({ service: "push" })

const MessageData = z.object({
  href: z.string(),
  sessionID: z.string().optional(),
  directory: z.string().optional(),
  kind: z.enum(["error", "turn-complete", "test"]),
})

export const PublicKey = z
  .object({
    supported: z.boolean(),
    publicKey: z.string().nullable(),
  })
  .meta({ ref: "PushPublicKey" })

export const Subscription = z
  .object({
    id: z.string(),
    deviceLabel: z.string().optional(),
    endpoint: z.string(),
    expirationTime: z.number().nullable().optional(),
    enabled: z.boolean(),
    failureCount: z.number(),
    lastError: z.string().optional(),
    lastFailureAt: z.number().nullable().optional(),
    lastSuccessAt: z.number().nullable().optional(),
    notifyOnCompletion: z.boolean(),
    notifyOnError: z.boolean(),
    serverOrigin: z.string(),
    userAgent: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  .meta({ ref: "PushSubscription" })

export const SubscriptionUpsert = z.object({
  deviceLabel: z.string().trim().max(120).optional(),
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    auth: z.string(),
    p256dh: z.string(),
  }),
  enabled: z.boolean().optional(),
  notifyOnCompletion: z.boolean().optional(),
  notifyOnError: z.boolean().optional(),
  serverOrigin: z.string().url(),
  userAgent: z.string().optional(),
})

export const SubscriptionUpdate = z.object({
  deviceLabel: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
})

export const TestInput = z.object({
  id: z.string().optional(),
})

export const TestResult = z
  .object({
    sent: z.boolean(),
  })
  .meta({ ref: "PushTestResult" })

type Kind = z.infer<typeof MessageData>[
  "kind"
]

type SessionMeta = {
  id: string
  directory: string
  parentID?: string
  title: string
}

type SessionID = typeof SessionTable.$inferSelect.id

type NotificationPayload = {
  title: string
  body: string
  tag: string
  icon: string
  badge: string
  data: z.infer<typeof MessageData>
  requireInteraction: boolean
}

type DeliveryUrgency = "high" | "normal"

type DeliverySettings = {
  ttlSeconds: number
  urgency: DeliveryUrgency
}

type DeliveryRow = typeof PushDeliveryTable.$inferSelect

let initialized = false
let configured = false
let drainScheduledAt: number | undefined
let drainTimer: ReturnType<typeof setTimeout> | undefined
let draining: Promise<void> | undefined

const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const
const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1

function vapid() {
  if (!Flag.OPENCODE_PUSH_VAPID_PUBLIC_KEY) return
  if (!Flag.OPENCODE_PUSH_VAPID_PRIVATE_KEY) return
  if (!Flag.OPENCODE_PUSH_VAPID_SUBJECT) return
  return {
    publicKey: Flag.OPENCODE_PUSH_VAPID_PUBLIC_KEY,
    privateKey: Flag.OPENCODE_PUSH_VAPID_PRIVATE_KEY,
    subject: Flag.OPENCODE_PUSH_VAPID_SUBJECT,
  }
}

function ensureConfigured() {
  const next = vapid()
  if (!next) return
  if (configured) return next
  webpush.setVapidDetails(next.subject, next.publicKey, next.privateKey)
  configured = true
  return next
}

function deliverySettings(kind: Kind): DeliverySettings {
  if (kind === "error") {
    return {
      ttlSeconds: 60 * 60 * 24,
      urgency: "high",
    }
  }

  if (kind === "test") {
    return {
      ttlSeconds: 60 * 30,
      urgency: "high",
    }
  }

  return {
    ttlSeconds: 60 * 60 * 12,
    urgency: "normal",
  }
}

function fromRow(row: typeof PushSubscriptionTable.$inferSelect) {
  return {
    id: row.id,
    deviceLabel: row.device_label ?? undefined,
    endpoint: row.endpoint,
    expirationTime: row.expiration_time ?? undefined,
    enabled: row.enabled,
    failureCount: row.failure_count,
    lastError: row.last_error ?? undefined,
    lastFailureAt: row.last_failure_at ?? undefined,
    lastSuccessAt: row.last_success_at ?? undefined,
    notifyOnCompletion: row.notify_on_completion,
    notifyOnError: row.notify_on_error,
    serverOrigin: row.server_origin,
    userAgent: row.user_agent ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function sessionMeta(sessionID: SessionID) {
  return Database.use((db) => {
    const row = db
      .select({
        id: SessionTable.id,
        directory: SessionTable.directory,
        parentID: SessionTable.parent_id,
        title: SessionTable.title,
      })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
    if (!row) return
    return {
      id: row.id,
      directory: row.directory,
      parentID: row.parentID ?? undefined,
      title: row.title,
    } satisfies SessionMeta
  })
}

function target(id?: string) {
  return Database.use((db) => {
    if (id) {
      return db.select().from(PushSubscriptionTable).where(eq(PushSubscriptionTable.id, id)).get()
    }

    return db.select().from(PushSubscriptionTable).orderBy(desc(PushSubscriptionTable.time_updated), desc(PushSubscriptionTable.id)).get()
  })
}

function dueDeliveries() {
  return Database.use((db) =>
    db
      .select()
      .from(PushDeliveryTable)
      .where(lte(PushDeliveryTable.next_attempt_at, Date.now()))
      .orderBy(asc(PushDeliveryTable.next_attempt_at), asc(PushDeliveryTable.id))
      .all(),
  )
}

function nextDelivery() {
  return Database.use((db) =>
    db
      .select({ nextAttemptAt: PushDeliveryTable.next_attempt_at })
      .from(PushDeliveryTable)
      .orderBy(asc(PushDeliveryTable.next_attempt_at), asc(PushDeliveryTable.id))
      .get(),
  )
}

function subscriptions(kind: Kind) {
  return Database.use((db) =>
    db
      .select()
      .from(PushSubscriptionTable)
      .where(
        eq(
          kind === "turn-complete" ? PushSubscriptionTable.notify_on_completion : PushSubscriptionTable.notify_on_error,
          true,
        ),
      )
      .orderBy(desc(PushSubscriptionTable.time_updated), desc(PushSubscriptionTable.id))
      .all()
      .filter((item) => item.enabled),
  )
}

function body(input: { kind: Kind; session: SessionMeta; error?: unknown }) {
  if (input.kind === "turn-complete") {
    return input.session.title || input.session.id
  }

  if (typeof input.error === "string" && input.error.trim()) return input.error
  if (input.error && typeof input.error === "object") {
    if ("message" in input.error && typeof input.error.message === "string" && input.error.message.trim()) {
      return input.error.message
    }
  }
  return input.session.title || input.session.id
}

function stopDrainTimer() {
  if (!drainTimer) return
  clearTimeout(drainTimer)
  drainTimer = undefined
  drainScheduledAt = undefined
}

function scheduleDrain(at = Date.now()) {
  if (!ensureConfigured()) return
  if (drainScheduledAt !== undefined && drainScheduledAt <= at) return
  stopDrainTimer()
  drainScheduledAt = at
  drainTimer = setTimeout(() => {
    drainTimer = undefined
    drainScheduledAt = undefined
    void kickDrain()
  }, Math.max(0, at - Date.now()))
}

function scheduleNextDrain() {
  if (!ensureConfigured()) return
  const next = nextDelivery()
  if (!next) {
    stopDrainTimer()
    return
  }
  scheduleDrain(next.nextAttemptAt)
}

export function payload(input: { kind: Kind; session: SessionMeta; error?: unknown }): NotificationPayload {
  const href = `/${base64Encode(input.session.directory)}/session/${input.session.id}`
  return {
    title: input.kind === "turn-complete" ? "Response ready" : "Session error",
    body: body(input),
    tag: `session:${input.session.id}:${input.kind}`,
    icon: "/favicon-96x96-v3.png",
    badge: "/notification-badge.svg",
    requireInteraction: false,
    data: {
      href,
      kind: input.kind,
      directory: input.session.directory,
      sessionID: input.session.id,
    },
  }
}

function testPayload(): NotificationPayload {
  return {
    title: "OpenCode test notification",
    body: "If you can see this, background Web Push is working.",
    tag: "opencode:test",
    icon: "/favicon-96x96-v3.png",
    badge: "/notification-badge.svg",
    requireInteraction: false,
    data: {
      href: "/",
      kind: "test",
    },
  }
}

function parsePayload(value: string) {
  try {
    return JSON.parse(value) as NotificationPayload
  } catch {
    return
  }
}

function clearDelivery(id: string) {
  Database.use((db) => {
    db.delete(PushDeliveryTable).where(eq(PushDeliveryTable.id, id)).run()
  })
}

function clearDeliveriesForSubscription(subscriptionID: string) {
  Database.use((db) => {
    db.delete(PushDeliveryTable).where(eq(PushDeliveryTable.subscription_id, subscriptionID)).run()
  })
}

function remove(id: string) {
  clearDeliveriesForSubscription(id)
  Database.use((db) => {
    db.delete(PushSubscriptionTable).where(eq(PushSubscriptionTable.id, id)).run()
  })
}

function fail(id: string, error: unknown) {
  const current = Database.use((db) => db.select().from(PushSubscriptionTable).where(eq(PushSubscriptionTable.id, id)).get())
  if (!current) return
  Database.use((db) => {
    db
      .update(PushSubscriptionTable)
      .set({
        failure_count: current.failure_count + 1,
        last_error: error instanceof Error ? error.message : String(error),
        last_failure_at: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(PushSubscriptionTable.id, id))
      .run()
  })
}

function retryDelayMs(attemptCount: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)]
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object") return
  if (!("statusCode" in error)) return
  return typeof error.statusCode === "number" ? error.statusCode : undefined
}

function enqueue(row: typeof PushSubscriptionTable.$inferSelect, notification: NotificationPayload) {
  const settings = deliverySettings(notification.data.kind)
  Database.use((db) => {
    db.delete(PushDeliveryTable).where(eq(PushDeliveryTable.tag, `${row.id}:${notification.tag}`)).run()
    db.insert(PushDeliveryTable).values({
      id: Slug.create(),
      subscription_id: row.id,
      payload: JSON.stringify(notification),
      kind: notification.data.kind,
      tag: `${row.id}:${notification.tag}`,
      ttl_seconds: settings.ttlSeconds,
      urgency: settings.urgency,
      next_attempt_at: Date.now(),
    }).run()
  })
  scheduleDrain()
}

async function send(row: typeof PushSubscriptionTable.$inferSelect, notification: NotificationPayload, settings: DeliverySettings) {
  const config = ensureConfigured()
  if (!config) return false
  try {
    await webpush.sendNotification(
      {
        endpoint: row.endpoint,
        expirationTime: row.expiration_time ?? null,
        keys: {
          auth: row.auth,
          p256dh: row.p256dh,
        },
      },
      JSON.stringify(notification),
      {
        TTL: settings.ttlSeconds,
        urgency: settings.urgency,
      },
    )
    Database.use((db) => {
      db
        .update(PushSubscriptionTable)
        .set({
          failure_count: 0,
          last_error: null,
          last_success_at: Date.now(),
          time_updated: Date.now(),
        })
        .where(eq(PushSubscriptionTable.id, row.id))
        .run()
    })
    return true
  } catch (error) {
    const status = statusCode(error)
    if (status === 404 || status === 410) {
      remove(row.id)
      return false
    }
    fail(row.id, error)
    throw error
  }
}

async function processDelivery(delivery: DeliveryRow) {
  const subscription = Database.use((db) =>
    db.select().from(PushSubscriptionTable).where(eq(PushSubscriptionTable.id, delivery.subscription_id)).get(),
  )
  if (!subscription) {
    clearDelivery(delivery.id)
    return
  }
  if (!subscription.enabled) {
    clearDelivery(delivery.id)
    return
  }

  const notification = parsePayload(delivery.payload)
  if (!notification) {
    clearDelivery(delivery.id)
    return
  }

  try {
    await send(subscription, notification, {
      ttlSeconds: delivery.ttl_seconds,
      urgency: delivery.urgency === "high" ? "high" : "normal",
    })
    clearDelivery(delivery.id)
  } catch (error) {
    const attempts = delivery.attempt_count + 1
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      clearDelivery(delivery.id)
      return
    }

    Database.use((db) => {
      db
        .update(PushDeliveryTable)
        .set({
          attempt_count: attempts,
          last_error: error instanceof Error ? error.message : String(error),
          last_status: statusCode(error),
          next_attempt_at: Date.now() + retryDelayMs(attempts),
          time_updated: Date.now(),
        })
        .where(eq(PushDeliveryTable.id, delivery.id))
        .run()
    })
  }
}

function kickDrain() {
  if (draining) return draining
  if (!ensureConfigured()) return Promise.resolve()
  stopDrainTimer()
  draining = (async () => {
    while (true) {
      const deliveries = dueDeliveries()
      if (deliveries.length === 0) return
      for (const delivery of deliveries) {
        await processDelivery(delivery)
      }
    }
  })().finally(() => {
    draining = undefined
    scheduleNextDrain()
  })
  return draining
}

async function dispatch(event: GlobalEvent) {
  const type = event.payload?.type
  if (type !== "session.idle" && type !== "session.error") return
  const sessionID = event.payload?.properties?.sessionID
  if (typeof sessionID !== "string") return

  const session = sessionMeta(sessionID as SessionID)
  if (!session || session.parentID) return

  const kind = type === "session.idle" ? "turn-complete" : "error"
  const targets = subscriptions(kind)
  if (targets.length === 0) return

  const notification = payload({ kind, session, error: event.payload?.properties?.error })
  targets.forEach((item) => enqueue(item, notification))
  await kickDrain()
}

export function init() {
  if (initialized) return
  initialized = true
  ensureConfigured()
  scheduleNextDrain()
  GlobalBus.on("event", (event) => {
    void dispatch(event).catch((error) => {
      log.error("dispatch failed", {
        error,
        type: event.payload?.type,
      })
    })
  })
}

export function publicKey() {
  const config = vapid()
  return {
    supported: !!config,
    publicKey: config?.publicKey ?? null,
  }
}

export function list() {
  return Database.use((db) =>
    db.select().from(PushSubscriptionTable).orderBy(desc(PushSubscriptionTable.time_updated), desc(PushSubscriptionTable.id)).all(),
  ).map(fromRow)
}

export function upsert(input: z.output<typeof SubscriptionUpsert>) {
  const existing = Database.use((db) =>
    db.select().from(PushSubscriptionTable).where(eq(PushSubscriptionTable.endpoint, input.endpoint)).get(),
  )

  if (existing) {
    Database.use((db) => {
      db
        .update(PushSubscriptionTable)
        .set({
          device_label: input.deviceLabel,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expiration_time: input.expirationTime ?? null,
          enabled: input.enabled ?? true,
          notify_on_completion: input.notifyOnCompletion ?? true,
          notify_on_error: input.notifyOnError ?? false,
          server_origin: input.serverOrigin,
          user_agent: input.userAgent,
          failure_count: 0,
          last_error: null,
          time_updated: Date.now(),
        })
        .where(eq(PushSubscriptionTable.id, existing.id))
        .run()
    })

    return fromRow(
      Database.use((db) => db.select().from(PushSubscriptionTable).where(eq(PushSubscriptionTable.id, existing.id)).get())!,
    )
  }

  const id = Slug.create()
  Database.use((db) => {
    db.insert(PushSubscriptionTable).values({
      id,
      device_label: input.deviceLabel,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      expiration_time: input.expirationTime ?? null,
      enabled: input.enabled ?? true,
      notify_on_completion: input.notifyOnCompletion ?? true,
      notify_on_error: input.notifyOnError ?? false,
      server_origin: input.serverOrigin,
      user_agent: input.userAgent,
      failure_count: 0,
      last_error: null,
    }).run()
  })
  return fromRow(Database.use((db) => db.select().from(PushSubscriptionTable).where(eq(PushSubscriptionTable.id, id)).get())!)
}

export function removeSubscription(id: string) {
  remove(id)
  return true
}

export function update(input: { id: string; value: z.output<typeof SubscriptionUpdate> }) {
  const next = {
    ...(input.value.deviceLabel !== undefined ? { device_label: input.value.deviceLabel } : {}),
    ...(input.value.enabled !== undefined ? { enabled: input.value.enabled } : {}),
    time_updated: Date.now(),
  }
  Database.use((db) => {
    db
      .update(PushSubscriptionTable)
      .set(next)
      .where(eq(PushSubscriptionTable.id, input.id))
      .run()
  })
  const row = Database.use((db) => db.select().from(PushSubscriptionTable).where(eq(PushSubscriptionTable.id, input.id)).get())
  if (!row) throw new Error(`Push subscription not found: ${input.id}`)
  return fromRow(row)
}

export async function test(input: z.output<typeof TestInput>) {
  if (!ensureConfigured()) return { sent: false }
  const row = target(input.id)
  if (!row) return { sent: false }
  enqueue(row, testPayload())
  await kickDrain()
  return { sent: true }
}

export * as Push from "."
