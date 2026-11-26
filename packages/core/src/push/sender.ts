export * as PushSender from "./sender.js"

import { Context, Effect, Layer, Option, Schema, Scope } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import type { Push } from "@opencode/schema/push"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { KV } from "../kv.js"
import { PushCrypto } from "./crypto.js"
import { PushList } from "./list.js"

/** A reply sends `value`, or `label` when there is no value. */
export interface Choice {
  readonly label: string
  readonly value?: string
  readonly description?: string
}

/** One field of a form, under the form's own key names. */
export interface Field {
  readonly key: string
  readonly type: string
  readonly title?: string
  readonly description?: string
  /** True when a typed answer is accepted. */
  readonly custom?: true
  readonly options?: ReadonlyArray<Choice>
}

export interface Data {
  readonly requestID?: string
  readonly formID?: string
  /** The session that asked, which replies name; it may be a subagent's. */
  readonly replySessionID?: string
  readonly action?: string
  readonly resources?: ReadonlyArray<string>
  /** How many resources the request has, when some were left out. */
  readonly resourceCount?: number
  readonly save?: ReadonlyArray<string>
  readonly decisions?: ReadonlyArray<string>
  readonly message?: string
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
  readonly kind?: string
  readonly count?: number
  /** A reply can be built from the message alone. Left out as soon as the message is too big. */
  readonly inlineReply?: true
  /** The form's first field. */
  readonly fields?: ReadonlyArray<Field>
  readonly outcome?: "succeeded" | "failed"
  readonly messageID?: string
  readonly idleMessageID?: string
  readonly text?: string
  readonly error?: {
    readonly type: string
    readonly message?: string
    readonly status?: number
    readonly retryAfterMs?: number
  }
  /** Something in `data` was cut or left out; the full version can be read by id. */
  readonly truncated?: true
}

export interface Notification {
  /** What a later `clear` names: the permission request, the form, or the session for a finished turn. */
  readonly id: string
  readonly type: "session.idle" | "form" | "permission"
  /** The top-level session, and the folder it works in. */
  readonly sessionID: string
  readonly directory: string
  /** When the event happened, in ms since the epoch. */
  readonly time: number
  readonly title: string
  readonly body: string
  readonly data: Data
  /** True when the session waits on the person, so phones at level `attention` get it. */
  readonly attention: boolean
}

export interface Interface {
  /** Sends to every phone that wants it, in the background. */
  readonly send: (notification: Notification) => Effect.Effect<void>
  /** Removes the notifications sent under these ids from the phones that got them, in the background. */
  readonly clear: (ids: ReadonlyArray<string>, time: number) => Effect.Effect<void>
  /** Removes every notification sent for this top-level session, for when the session is deleted. */
  readonly clearSession: (sessionID: string, time: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PushSender") {}

const maxMessageBytes = 2600
const maxBodyChars = 200
const attempts = 3
// Which phones were sent a notification, so a clear goes only to them.
const Sent = Schema.Struct({ sessionID: Schema.String, devices: Schema.Array(Schema.String) })
const decodeSent = Schema.decodeUnknownOption(Sent)
const sentKey = (id: string) => `push:sent:${id}`
const sentPrefix = "push:sent:"

/**
 * Drops characters from the end of `text` until its JSON is at least `bytes` shorter, then adds "…". Undefined when
 * nothing is left.
 */
const shorten = (text: string, bytes: number) => {
  const chars = Array.from(text)
  let dropped = 0
  while (chars.length > 0 && dropped < bytes + 3) {
    dropped += Buffer.byteLength(JSON.stringify(chars.pop()), "utf8") - 2
  }
  if (chars.length === 0) return undefined
  return chars.join("") + "…"
}

type Over = (data: Data) => number
/** One cut, applied while the message is still too big. */
type Step = (data: Data, over: Over) => Data

/** Keeps resources in order while they fit. The first that doesn't is shortened if that fits, and the rest are dropped. */
const cutResources: Step = (data, over) => {
  const all = data.resources
  if (!all) return data
  const cut = (kept: ReadonlyArray<string>): Data => ({
    ...data,
    resources: kept,
    ...(kept.length < all.length && { resourceCount: all.length }),
    truncated: true,
  })
  const kept: string[] = []
  for (const item of all) {
    const bytes = over(cut([...kept, item]))
    if (bytes > 0) {
      const short = shorten(item, bytes)
      return cut(short === undefined ? kept : [...kept, short])
    }
    kept.push(item)
  }
  return cut(kept)
}

/** A cut to the form's field. `change` returns undefined when it has nothing to cut. */
const cutField =
  (change: (field: Field, over: (field: Field) => number) => Field | undefined): Step =>
  (data, over) => {
    const [field] = data.fields ?? []
    const cut = (field: Field): Data => ({ ...data, fields: [field], truncated: true })
    const next = field && change(field, (field) => over(cut(field)))
    return next ? cut(next) : data
  }

// In the order of specs/v2/push.md: bulk goes before small facts.
const steps: ReadonlyArray<Step> = [
  (data) => (data.inlineReply ? { ...data, inlineReply: undefined, truncated: true } : data),
  (data) => (data.text === undefined ? data : { ...data, text: undefined, truncated: true }),
  (data, over) => {
    if (data.error?.message === undefined) return data
    const marked: Data = { ...data, truncated: true }
    return { ...marked, error: { ...data.error, message: shorten(data.error.message, over(marked)) } }
  },
  cutResources,
  cutField((field) =>
    field.options?.some((option) => option.description !== undefined)
      ? { ...field, options: field.options.map((option) => ({ label: option.label, value: option.value })) }
      : undefined,
  ),
  cutField((field, over) =>
    field.description === undefined ? undefined : { ...field, description: shorten(field.description, over(field)) },
  ),
]

/**
 * The JSON the phone decrypts, cut so the box stays within the relay's limit. Anything cut or left out of `data` sets
 * `truncated: true`. Ids, the title and the body are never cut. The format is described in specs/v2/push.md.
 */
export const message = (notification: Notification) => {
  const chars = Array.from(notification.body)
  const body = chars.length > maxBodyChars ? chars.slice(0, maxBodyChars - 1).join("") + "…" : notification.body
  const make = (data: Data, directory?: string) =>
    JSON.stringify({
      v: 1,
      type: notification.type,
      id: notification.id,
      time: notification.time,
      sessionID: notification.sessionID,
      directory,
      ...(notification.attention && { attention: true }),
      title: notification.title,
      body,
      data,
    })
  const over: Over = (data) => Buffer.byteLength(make(data, notification.directory), "utf8") - maxMessageBytes
  const data = steps.reduce((data, step) => (over(data) > 0 ? step(data, over) : data), notification.data)
  if (over(data) <= 0) return make(data, notification.directory)
  return make({
    requestID: data.requestID,
    formID: data.formID,
    replySessionID: data.replySessionID,
    kind: data.kind,
    count: data.count,
    decisions: data.decisions,
    outcome: data.outcome,
    messageID: data.messageID,
    idleMessageID: data.idleMessageID,
    truncated: true,
  })
}

export const level = (device: PushList.Stored, sessions: Record<string, Push.Bell>, sessionID: string) =>
  device.sessions[sessionID]?.level ?? sessions[sessionID]?.level ?? device.settings.default

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const list = yield* PushList.Service
    const kv = yield* KV.Service
    const http = yield* HttpClient.HttpClient
    const scope = yield* Scope.Scope

    // The relay delivers a silent box without an alert: it only wakes the app.
    const post = (url: string, box: string, silent: boolean) =>
      http
        .execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(silent ? { box, silent } : { box })))
        .pipe(
          Effect.flatMap((response) => response.text.pipe(Effect.ignore, Effect.as(response.status))),
          Effect.timeout("10 seconds"),
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          Effect.orElseSucceed(() => undefined),
        )

    const push = Effect.fn("PushSender.push")(function* (device: PushList.Stored, text: string, silent: boolean) {
      const box = PushCrypto.seal(device.secret, device.id, text)
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const status = yield* post(device.callbackURL, box, silent)
        if (status === 404 || status === 410) return yield* list.removeGone(device.id, device.callbackURL)
        if (status !== undefined && status < 300) return
        if (status !== undefined && status < 500)
          return yield* Effect.logWarning("relay rejected a push notification", { deviceID: device.id, status })
        if (attempt < attempts) yield* Effect.sleep("1 second")
      }
      yield* Effect.logWarning("gave up sending a push notification", { deviceID: device.id, attempts })
    })

    const getSent = Effect.fn("PushSender.getSent")(function* (id: string) {
      return Option.getOrUndefined(decodeSent(yield* kv.get(sentKey(id))))
    })

    const deliver = Effect.fn("PushSender.deliver")(function* (notification: Notification) {
      const targets = yield* list.targets()
      if (targets.settings.paused) return
      const devices = targets.devices.filter((device) => {
        if (device.paused) return false
        const wanted = level(device, targets.sessions, notification.sessionID)
        if (wanted === "none") return false
        if (wanted === "attention" && !notification.attention) return false
        return true
      })
      if (devices.length === 0) return
      const previous = yield* getSent(notification.id)
      // Recorded before pushing, so a clear that comes while the pushes are in flight still reaches these phones.
      yield* kv.set(sentKey(notification.id), {
        sessionID: notification.sessionID,
        devices: Array.from(new Set([...(previous?.devices ?? []), ...devices.map((device) => device.id)])),
      })
      yield* Effect.forEach(
        devices,
        (device) =>
          push(device, message(notification), false).pipe(
            Effect.ignoreCause({ log: "Warn", message: "Failed to send a push notification" }),
          ),
        { concurrency: "unbounded", discard: true },
      )
    })

    const clear = Effect.fn("PushSender.clear")(function* (ids: ReadonlyArray<string>, time: number) {
      const cleared: (typeof Sent.Type & { id: string })[] = []
      for (const id of ids) {
        const sent = yield* getSent(id)
        yield* kv.remove(sentKey(id))
        if (sent) cleared.push({ id, ...sent })
      }
      if (cleared.length === 0) return
      const targets = yield* list.targets()
      yield* Effect.forEach(
        cleared.flatMap((item) =>
          targets.devices
            .filter((device) => item.devices.includes(device.id))
            .map((device) => push(device, JSON.stringify({ v: 1, type: "clear", ids: [item.id], time }), true)),
        ),
        Effect.ignoreCause({ log: "Warn", message: "Failed to clear a push notification" }),
        { concurrency: "unbounded", discard: true },
      )
    })

    const clearSession = Effect.fn("PushSender.clearSession")(function* (sessionID: string, time: number) {
      const ids: string[] = []
      let after: string | undefined
      while (true) {
        const page = yield* kv.scan({ prefix: sentPrefix, after, limit: 1000 })
        for (const entry of page.entries) {
          const sent = decodeSent(entry.value)
          if (Option.isSome(sent) && sent.value.sessionID === sessionID) ids.push(entry.key.slice(sentPrefix.length))
        }
        if (!page.next) break
        after = page.next
      }
      yield* clear(ids, time)
    })

    return Service.of({
      send: (notification) => deliver(notification).pipe(Effect.forkIn(scope), Effect.asVoid),
      clear: (ids, time) => clear(ids, time).pipe(Effect.forkIn(scope), Effect.asVoid),
      clearSession: (sessionID, time) => clearSession(sessionID, time).pipe(Effect.forkIn(scope), Effect.asVoid),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [PushList.node, KV.node, httpClient] })
