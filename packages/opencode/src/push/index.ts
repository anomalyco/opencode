import { base64Encode } from "@opencode-ai/shared/util/encode"
import { Slug } from "@opencode-ai/shared/util/slug"
import { Log } from "@/util"
import { Flag } from "@/flag/flag"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Database, desc, eq } from "@/storage"
import { SessionTable } from "@/session/session.sql"
import { PushSubscriptionTable } from "./push.sql"
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

let initialized = false
let configured = false

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

function remove(id: string) {
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

async function send(row: typeof PushSubscriptionTable.$inferSelect, notification: NotificationPayload) {
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
    const status = typeof error === "object" && error && "statusCode" in error ? error.statusCode : undefined
    if (status === 404 || status === 410) {
      remove(row.id)
      return false
    }
    fail(row.id, error)
    throw error
  }
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
  await Promise.allSettled(targets.map((item) => send(item, notification)))
}

export function init() {
  if (initialized) return
  initialized = true
  ensureConfigured()
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
  try {
    return { sent: await send(row, testPayload()) }
  } catch (error) {
    log.error("test push failed", {
      error,
      subscriptionID: row.id,
    })
    return { sent: false }
  }
}

export * as Push from "."
