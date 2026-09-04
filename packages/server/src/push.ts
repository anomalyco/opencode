export * as Push from "./push"

import { Bus } from "@opencode-ai/core/bus"
import { KV } from "@opencode-ai/core/kv"
import { SessionStore } from "@opencode-ai/core/session/store"
import { PushSubscription } from "@opencode-ai/protocol/groups/push"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import type { Event } from "@opencode-ai/schema/event"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Cause, Context, Effect, Layer, Option, Queue, Schema, Semaphore } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { createHmac } from "node:crypto"

const Prefix = "web-push:v1:subscription:"
const Key = "web-push:v1:key"
const AuthKey = "web-push:v1:authorization"
export const SubscriptionLimit = 100
export const QueueCapacity = 128
export const DeliveryTimeout = "10 seconds"
export const TTL = 3600

const Vapid = Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String })
const Authorization = Schema.Struct({ salt: Schema.String, fingerprint: Schema.String })
type Terminal = typeof SessionEvent.Execution.Succeeded.Type | typeof SessionEvent.Execution.Failed.Type
const isTerminal = (event: Event.Payload): event is Terminal =>
  event.type === SessionEvent.Execution.Succeeded.type || event.type === SessionEvent.Execution.Failed.type

export interface Interface {
  readonly get: Effect.Effect<{ publicKey: string }, ServiceUnavailableError>
  readonly subscribe: (input: PushSubscription) => Effect.Effect<void, InvalidRequestError | ServiceUnavailableError>
  readonly unsubscribe: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/Push") {}

export function validEndpoint(input: string) {
  if (!URL.canParse(input) || /[\s#]/.test(input)) return false
  const url = new URL(input)
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) return false
  return (
    url.hostname === "fcm.googleapis.com" ||
    [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"].some((suffix) =>
      url.hostname.endsWith(suffix),
    )
  )
}

export function validSessionURL(input: string) {
  if (!URL.canParse(input) || /[\s?#]/.test(input)) return false
  const url = new URL(input)
  if (url.username || url.password || url.search || url.hash) return false
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    return false
  return /^\/server\/[A-Za-z0-9_-]+\/session\/$/.test(url.pathname)
}

const makeWith = (options: { readonly password?: string } = {}) =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const bus = yield* Bus.Service
    const sessions = yield* SessionStore.Service
    const request = yield* FetchHttpClient.Fetch
    const lock = yield* Semaphore.make(1)
    const queue = yield* Queue.dropping<Terminal>(QueueCapacity)
    yield* Effect.addFinalizer(() => Queue.shutdown(queue))
    const subscriptions = new Map<string, PushSubscription>()
    const authorization = Schema.decodeUnknownOption(Authorization)(yield* kv.get(AuthKey))
    const salt = Option.isSome(authorization) ? authorization.value.salt : crypto.randomUUID()
    const fingerprint = createHmac("sha256", salt)
      .update(options.password ? `password:${options.password}` : "disabled")
      .digest("hex")
    if (Option.isNone(authorization) || authorization.value.fingerprint !== fingerprint) {
      // Revoke before installing the listener. Write the marker last so interrupted
      // cleanup is retried; legacy subscriptions without a binding are revoked too.
      while (true) {
        const stale = yield* kv.scan({ prefix: Prefix, limit: SubscriptionLimit })
        yield* Effect.forEach(stale.entries, (entry) => kv.remove(entry.key), { discard: true })
        if (!stale.next) break
      }
      yield* kv.set(AuthKey, { salt, fingerprint })
    }
    const stored = yield* kv.scan({ prefix: Prefix, limit: SubscriptionLimit })
    for (const entry of stored.entries) {
      const decoded = Schema.decodeUnknownOption(PushSubscription)(entry.value)
      if (Option.isNone(decoded) || !validEndpoint(decoded.value.endpoint) || !validSessionURL(decoded.value.url))
        continue
      subscriptions.set(decoded.value.id, decoded.value)
    }

    const library = yield* Effect.cached(
      Effect.tryPromise({
        try: () => import("web-push"),
        catch: () =>
          new ServiceUnavailableError({ message: "Web Push is unavailable in this runtime", service: "push" }),
      }),
    )
    const keys = yield* Effect.cached(
      Effect.gen(function* () {
        const existing = yield* kv.get(Key)
        if (existing !== undefined)
          return yield* Schema.decodeUnknownEffect(Vapid)(existing).pipe(
            Effect.mapError(
              () => new ServiceUnavailableError({ message: "Web Push key is unavailable", service: "push" }),
            ),
          )
        const webpush = yield* library
        const keys = webpush.generateVAPIDKeys()
        yield* kv.set(Key, { ...keys })
        return keys
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

    const send = Effect.fnUntraced(function* (subscription: PushSubscription, payload: string) {
      const webpush = yield* library
      const vapid = yield* keys
      const details = yield* Effect.try(() =>
        webpush.generateRequestDetails(subscription, payload, {
          TTL,
          urgency: "normal",
          contentEncoding: "aes128gcm",
          vapidDetails: { subject: "https://opencode.ai", ...vapid },
        }),
      )
      // web-push owns encryption/signing; fetch owns cancellable, no-redirect transport.
      // Do not use the shared HttpClient's URL tracing for capability-bearing push endpoints.
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
      })
      if (status === 404 || status === 410) {
        yield* remove(subscription.id, subscription)
        return
      }
      if (status < 200 || status >= 300) yield* Effect.logWarning("Web Push delivery rejected", { status })
    })

    const deliver = Effect.fnUntraced(function* (event: Terminal) {
      const session = yield* sessions.get(event.data.sessionID)
      if (!session || session.parentID) return
      const kind = event.type === "session.execution.succeeded" ? "agent" : "errors"
      const current = Array.from(subscriptions.values()).filter((subscription) => subscription.notifications[kind])
      yield* Effect.forEach(
        current,
        (subscription) =>
          Effect.suspend(() => {
            if (subscriptions.get(subscription.id) !== subscription) return Effect.void
            const payload = JSON.stringify({
              title: subscription.titles[kind],
              body: (session.title ?? session.id).slice(0, 200),
              url: subscription.url + session.id,
              tag: event.id,
            })
            if (new TextEncoder().encode(payload).byteLength > 3500) return Effect.void
            return send(subscription, payload).pipe(
              Effect.timeout(DeliveryTimeout),
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterruptsOnly(cause),
                () => Effect.logWarning("Web Push delivery failed"),
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
    const unsubscribe = yield* bus.listen((event) => {
      if (!isTerminal(event)) return Effect.void
      if (subscriptions.size === 0) return Effect.void
      return Queue.offer(queue, event).pipe(
        Effect.flatMap((accepted) =>
          accepted ? Effect.void : Effect.logWarning("Web Push queue full; notification dropped"),
        ),
      )
    })
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({
      get: keys.pipe(Effect.map((value) => ({ publicKey: value.publicKey }))),
      subscribe: Effect.fnUntraced(function* (input) {
        if (!validEndpoint(input.endpoint))
          yield* new InvalidRequestError({ message: "Unsupported Web Push endpoint", field: "endpoint" })
        if (!validSessionURL(input.url))
          yield* new InvalidRequestError({ message: "Invalid app session URL", field: "url" })
        const webpush = yield* library
        yield* Effect.try({
          try: () => webpush.encrypt(input.keys.p256dh, input.keys.auth, "validate", "aes128gcm"),
          catch: () => new InvalidRequestError({ message: "Invalid Web Push subscription keys", field: "keys" }),
        })
        yield* keys
        yield* lock.withPermit(
          Effect.gen(function* () {
            if (!subscriptions.has(input.id) && subscriptions.size >= SubscriptionLimit)
              yield* new InvalidRequestError({ message: "Web Push subscription limit reached" })
            yield* kv.set(Prefix + input.id, input)
            subscriptions.set(input.id, input)
          }),
        )
      }),
      unsubscribe: (id) => remove(id),
    })
  })

export const make = makeWith()

export function configured(options?: { readonly password?: string }) {
  return makeGlobalNode({
    service: Service,
    layer: Layer.effect(Service, makeWith(options)),
    deps: [Bus.node, KV.node, SessionStore.node],
  })
}

export const node = configured()
