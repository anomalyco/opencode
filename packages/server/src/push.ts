export * as Push from "./push"

import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { SessionStore } from "@opencode/core/session/store"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { PushCategory, PushSubscription } from "@opencode/protocol/groups/push"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionID } from "@opencode/schema/session-id"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { Event } from "@opencode/schema/event"
import { Cause, Clock, Context, Effect, Layer, Option, Queue, Schema, Semaphore, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { createHmac } from "node:crypto"

const Prefix = "web-push:v1:subscription:"
const Key = "web-push:v1:key"
const AuthKey = "web-push:v1:authorization"

export const SubscriptionLimit = 100
export const QueueCapacity = 128
export const DeliveryTimeout = "10 seconds"
export const TTL = 3_600
// Browser push services reject bodies above 4 KiB after encryption; keep room for the
// aes128gcm header and padding.
export const MaxPayloadBytes = 3_500
// A device that has not refreshed in this long is assumed to be gone. Subscriptions are
// refreshed whenever an enabled app opens or changes its notification preferences.
export const SubscriptionRetention = 60 * 24 * 60 * 60 * 1000

const Subject = "https://opencode.ai"

const Vapid = Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String })
const Authorization = Schema.Struct({ fingerprint: Schema.String })
const Stored = Schema.Struct({ subscription: PushSubscription, updated: Schema.Finite })

type NotificationEvent =
  | Event.Payload<typeof SessionEvent.Execution.Succeeded>
  | Event.Payload<typeof SessionEvent.Execution.Failed>
  | Event.Payload<typeof Permission.Event.Asked>
  | Event.Payload<typeof Permission.Event.Replied>
  | Event.Payload<typeof Form.Event.Created>

type Delivery = "delivered" | "expired" | "failed"

const FallbackTitles: Record<PushCategory, string> = {
  agent: "Agent finished",
  permissions: "Approval needed",
  questions: "Input needed",
  errors: "Agent encountered an error",
}

const pushHosts = new Set(["fcm.googleapis.com"])

const pushSuffixes = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"]

export function validEndpoint(input: string) {
  if (!URL.canParse(input) || /[\s#]/.test(input)) return false
  const url = new URL(input)
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) return false
  if (pushHosts.has(url.hostname)) return true
  return pushSuffixes.some((suffix) => url.hostname.endsWith(suffix))
}

export function validSessionURL(input: string) {
  if (!URL.canParse(input) || /[\s?#]/.test(input)) return false
  const url = new URL(input)
  if (url.username || url.password || url.search || url.hash) return false
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) return false
  return /^\/server\/[A-Za-z0-9_-]+\/session\/$/.test(url.pathname)
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d+){3}$/.test(hostname)
}

function category(event: NotificationEvent): PushCategory | undefined {
  switch (event.type) {
    case "session.execution.succeeded":
      return "agent"
    case "session.execution.failed":
      return "errors"
    case "permission.asked":
      return "permissions"
    case "permission.replied":
      return undefined
    case "form.created":
      return event.data.form.metadata?.kind === "question" ? "questions" : undefined
  }
}

function sessionID(event: NotificationEvent) {
  if (event.type === "form.created") {
    const id = Schema.decodeUnknownOption(SessionID)(event.data.form.sessionID)
    return Option.getOrUndefined(id)
  }
  return event.data.sessionID
}

function payload(subscription: PushSubscription, input: { category: PushCategory; sessionID: string }) {
  return JSON.stringify({
    title: subscription.titles[input.category] ?? FallbackTitles[input.category],
    body: "",
    // The session title is deliberately absent: lock-screen previews would otherwise leak
    // prompt-derived text, and the push service must not learn it either.
    url: subscription.url + input.sessionID,
    tag: input.sessionID,
    kind: input.category,
  })
}

export function validPayload(input: string) {
  return new TextEncoder().encode(input).byteLength <= MaxPayloadBytes
}

export interface Interface {
  readonly get: Effect.Effect<{ readonly publicKey: string }, ServiceUnavailableError>
  readonly subscribe: (input: PushSubscription) => Effect.Effect<{ readonly id: string }, InvalidRequestError | ServiceUnavailableError>
  readonly unsubscribe: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/Push") {}

function unavailable(message: string) {
  return new ServiceUnavailableError({ message, service: "push" })
}

const makeWith = (options: { readonly password?: string } = {}) =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const bus = yield* Bus.Service
    const sessions = yield* SessionStore.Service
    const request = yield* FetchHttpClient.Fetch
    const lock = yield* Semaphore.make(1)
    const queue = yield* Queue.dropping<NotificationEvent>(QueueCapacity)
    yield* Effect.addFinalizer(() => Queue.shutdown(queue))

    const subscriptions = new Map<string, PushSubscription>()
    // Permission requests answered before their notification delay elapsed.
    const answered = new Map<string, number>()
    const authorization = Schema.decodeUnknownOption(Authorization)(yield* kv.get(AuthKey))
    const fingerprint = createHmac("sha256", "opencode-web-push-v1")
      .update(options.password ?? "disabled")
      .digest("hex")

    // Changing the server password revokes sessions, so it must revoke push registrations
    // too. Do it before loading subscriptions, and write the marker last so an interrupted
    // cleanup runs again on the next boot.
    if (Option.isNone(authorization) || authorization.value.fingerprint !== fingerprint) {
      let after: string | undefined
      for (;;) {
        const page = yield* kv.scan({ prefix: Prefix, after, limit: SubscriptionLimit })
        yield* Effect.forEach(page.entries, (entry) => kv.remove(entry.key), { discard: true })
        if (!page.next) break
        after = page.next
      }
      yield* kv.set(AuthKey, { fingerprint })
    }

    const now = yield* Clock.currentTimeMillis
    let after: string | undefined
    for (;;) {
      const page = yield* kv.scan({ prefix: Prefix, after, limit: SubscriptionLimit })
      for (const entry of page.entries) {
        const stored = Schema.decodeUnknownOption(Stored)(entry.value)
        if (Option.isNone(stored)) {
          yield* kv.remove(entry.key)
          continue
        }
        if (now - stored.value.updated > SubscriptionRetention || !validEndpoint(stored.value.subscription.endpoint)) {
          yield* kv.remove(entry.key)
          continue
        }
        subscriptions.set(stored.value.subscription.id, stored.value.subscription)
      }
      if (!page.next) break
      after = page.next
    }

    const library = yield* Effect.cached(
      Effect.tryPromise({
        try: () => import("web-push"),
        catch: () => unavailable("Web Push is unavailable in this runtime"),
      }),
    )

    const keys = yield* Effect.cached(
      Effect.gen(function* () {
        const existing = yield* kv.get(Key)
        if (existing !== undefined) {
          const decoded = Schema.decodeUnknownOption(Vapid)(existing)
          if (Option.isSome(decoded)) return decoded.value
          // A damaged key cannot authenticate existing subscriptions. Rotate it and
          // force every device to register again.
          yield* Effect.forEach(
            Array.from(subscriptions.keys()),
            (id) => kv.remove(Prefix + id),
            { discard: true },
          )
          subscriptions.clear()
        }
        const webpush = yield* library
        const generated = webpush.generateVAPIDKeys()
        const value = { publicKey: generated.publicKey, privateKey: generated.privateKey }
        yield* kv.set(Key, value)
        return value
      }),
    )

    const remove = Effect.fnUntraced(function* (id: string, expected?: PushSubscription) {
      yield* lock.withPermit(
        Effect.gen(function* () {
          // An expired in-flight endpoint must not delete its replacement.
          if (expected && subscriptions.get(id) !== expected) return
          yield* kv.remove(Prefix + id)
          subscriptions.delete(id)
        }),
      )
    })

    const send = Effect.fnUntraced(function* (subscription: PushSubscription, body: string) {
      const webpush = yield* library
      const vapid = yield* keys
      const details = yield* Effect.try({
        try: () =>
          webpush.generateRequestDetails(subscription, body, {
            TTL,
            urgency: "normal",
            contentEncoding: "aes128gcm",
            vapidDetails: { subject: Subject, ...vapid },
          }),
        catch: () => new Error("Web Push request could not be encoded"),
      })
      const status = yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await request(details.endpoint, {
            method: "POST",
            headers: details.headers,
            body: new Uint8Array(details.body),
            credentials: "omit",
            redirect: "error",
            signal,
          })
          await response.body?.cancel()
          return response.status
        },
        catch: () => new Error("Web Push transport failed"),
      }).pipe(
        Effect.timeoutOption(DeliveryTimeout),
        Effect.map(Option.getOrUndefined),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
          return Effect.logWarning("Web Push delivery failed", { cause }).pipe(Effect.as(undefined))
        }),
      )
      if (status === undefined) return "failed" satisfies Delivery
      if (status === 404 || status === 410) return "expired" satisfies Delivery
      if (status < 200 || status >= 300) {
        yield* Effect.logWarning("Web Push delivery rejected", { status })
        return "failed" satisfies Delivery
      }
      return "delivered" satisfies Delivery
    })

    const deliver = Effect.fnUntraced(function* (event: NotificationEvent) {
      const kind = category(event)
      if (!kind) return
      // A permission answered immediately (auto-approve, or the user is already in the
      // app) should not buzz a phone. Give the reply a moment to win the race.
      if (kind === "permissions" && event.type === "permission.asked") {
        yield* Effect.sleep("1 second")
        const replied = answered.get(event.data.id)
        if (replied !== undefined) return
      }
      const id = sessionID(event)
      if (!id) return
      const session = yield* sessions.get(id)
      // Subagent work is part of its parent's run; only tell the user when the root finishes.
      if (!session || session.parentID) return
      const current = Array.from(subscriptions.values()).filter((subscription) => subscription.preferences[kind])
      yield* Effect.forEach(
        current,
        (subscription) =>
          Effect.suspend(() => {
            if (subscriptions.get(subscription.id) !== subscription) return Effect.void
            const body = payload(subscription, { category: kind, sessionID: id })
            if (!validPayload(body)) return Effect.void
            return send(subscription, body).pipe(
              Effect.flatMap((result) =>
                result === "expired" ? remove(subscription.id, subscription) : Effect.void,
              ),
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterruptsOnly(cause),
                () => Effect.logWarning("Web Push notification failed"),
              ),
            )
          }),
        { concurrency: 4, discard: true },
      )
    })

    yield* Effect.gen(function* () {
      const event = yield* Queue.take(queue)
      yield* deliver(event).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          () => Effect.logWarning("Web Push event delivery failed"),
        ),
      )
    }).pipe(Effect.forever, Effect.forkScoped)

    yield* bus
      .subscribe([
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        Permission.Event.Asked,
        Permission.Event.Replied,
        Form.Event.Created,
      ])
      .pipe(
        Stream.runForEach((event) => {
          if (event.type === "permission.replied")
            return Clock.currentTimeMillis.pipe(
              Effect.tap((now) =>
                Effect.sync(() => {
                  answered.set(event.data.requestID, now)
                  for (const [id, at] of answered) if (now - at > 60_000) answered.delete(id)
                }),
              ),
              Effect.asVoid,
            )
          return Queue.offer(queue, event as NotificationEvent).pipe(
            Effect.flatMap((accepted) =>
              accepted ? Effect.void : Effect.logWarning("Web Push queue is closed; notification dropped"),
            ),
          )
        }),
        Effect.forkScoped,
      )

    return Service.of({
      get: keys.pipe(Effect.map((value) => ({ publicKey: value.publicKey }))),
      subscribe: Effect.fnUntraced(function* (input: PushSubscription): Effect.fn.Return<
        { readonly id: string },
        InvalidRequestError | ServiceUnavailableError
      > {
        if (!validEndpoint(input.endpoint))
          return yield* new InvalidRequestError({ message: "Unsupported Web Push endpoint", field: "endpoint" })
        if (!validSessionURL(input.url))
          return yield* new InvalidRequestError({ message: "Invalid app session URL", field: "url" })
        const webpush = yield* library
        yield* Effect.try({
          try: () => webpush.encrypt(input.keys.p256dh, input.keys.auth, "validate", "aes128gcm"),
          catch: () => new InvalidRequestError({ message: "Invalid Web Push subscription keys", field: "keys" }),
        })
        yield* keys
        yield* lock.withPermit(
          Effect.gen(function* () {
            if (!subscriptions.has(input.id) && subscriptions.size >= SubscriptionLimit)
              return yield* new InvalidRequestError({ message: "Web Push subscription limit reached" })
            const updated = yield* Clock.currentTimeMillis
            yield* kv.set(Prefix + input.id, { subscription: input, updated })
            subscriptions.set(input.id, input)
          }),
        )
        return { id: input.id }
      }),
      unsubscribe: (id) => remove(id),
    })
  })

export const make = makeWith()

export function configured(options?: { readonly password?: string }) {
  const layer: Layer.Layer<Service, never, Bus.Service | KV.Service | SessionStore.Service> = Layer.effect(
    Service,
    makeWith(options),
  )
  return makeGlobalNode({
    service: Service,
    layer,
    deps: [Bus.node, KV.node, SessionStore.node],
  })
}

/** Keeps the route surface available without touching the database or listening to events. */
export const disabled = Layer.succeed(
  Service,
  Service.of({
    get: Effect.fail(unavailable("Web Push is not available in this server")),
    subscribe: () => Effect.fail(unavailable("Web Push is not available in this server")),
    unsubscribe: () => Effect.void,
  }),
)

export const node = configured()
