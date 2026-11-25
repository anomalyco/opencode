export * as PushSender from "./sender.js"

import { Clock, Context, Effect, Layer, Option, Schema, Scope } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import type { Push } from "@opencode/schema/push"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { KV } from "../kv.js"
import { PushCrypto } from "./crypto.js"
import { PushList } from "./list.js"

export interface Option {
  readonly label: string
  /** Only when it differs from the label. */
  readonly value?: string
}

/** The first question of a form. */
export interface Question {
  readonly key: string
  readonly type: string
  readonly options?: ReadonlyArray<Option>
  readonly truncated?: true
}

export interface Data {
  readonly requestID?: string
  readonly formID?: string
  readonly sessionID?: string
  readonly action?: string
  readonly resources?: ReadonlyArray<string>
  readonly save?: ReadonlyArray<string>
  readonly count?: number
  readonly question?: Question
  readonly outcome?: "succeeded" | "failed"
  readonly text?: string
  readonly error?: { readonly type: string; readonly message?: string }
  readonly truncated?: true
}

export interface Notification {
  /** What a later `clear` names: the permission request, the form, or the session for a finished turn. */
  readonly id: string
  readonly type: "session.idle" | "question" | "permission"
  readonly sessionID: string
  /** When the event happened, in ms since the epoch. */
  readonly time: number
  readonly title: string
  readonly body: string
  readonly data: Data
  /** True when the notification needs the person, so phones at level `attention` get it. */
  readonly attention: boolean
}

export interface Interface {
  /** Sends to every phone that wants it, in the background. */
  readonly send: (notification: Notification) => Effect.Effect<void>
  /** Removes the notifications sent under these ids from the phones that got them, in the background. */
  readonly clear: (ids: ReadonlyArray<string>) => Effect.Effect<void>
  /** Removes every notification sent for this top-level session, for when the session is deleted. */
  readonly clearSession: (sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PushSender") {}

const maxMessageBytes = 2600
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

/** Keeps `items` in order while they fit. The first that doesn't is shortened if that fits, and the rest are dropped. */
const cutList = <T>(
  items: ReadonlyArray<T>,
  cut: (kept: ReadonlyArray<T>) => Data,
  over: Over,
  shortenItem: (item: T, bytes: number) => T | undefined,
) => {
  const kept: T[] = []
  for (const item of items) {
    const next = cut([...kept, item])
    if (over(next) > 0) {
      const short = shortenItem(item, over(next))
      if (short === undefined || over(cut([...kept, short])) > 0) return cut(kept)
      return cut([...kept, short])
    }
    kept.push(item)
  }
  return cut(kept)
}

const shortenError = (data: Data, over: Over): Data => {
  if (data.error?.message === undefined || over(data) <= 0) return data
  return { ...data, error: { ...data.error, message: shorten(data.error.message, over(data)) } }
}

const shortenResources = (data: Data, over: Over) => {
  if (!data.resources?.length || over(data) <= 0) return data
  return cutList(data.resources, (kept) => ({ ...data, resources: kept, truncated: true }), over, shorten)
}

// An option is never shortened: without a value, its label is what a reply sends.
const shortenOptions = (data: Data, over: Over) => {
  const question = data.question
  if (!question?.options?.length || over(data) <= 0) return data
  const cut = (kept: ReadonlyArray<Option>): Data => ({
    ...data,
    question: { ...question, options: kept, truncated: true },
  })
  return cutList(question.options, cut, over, () => undefined)
}

/**
 * The JSON the phone decrypts, shortened so the box stays within the relay's limit. A failed turn's error message is
 * cut first, then the turn's text and a permission's `save` are dropped. A permission's resources or a question's
 * options keep their order and come with `truncated: true`. The body is cut last; ids never are.
 */
export const message = (notification: Notification) => {
  const make = (data: Data, body = notification.body) =>
    JSON.stringify({
      v: 1,
      id: notification.id,
      type: notification.type,
      sessionID: notification.sessionID,
      time: notification.time,
      title: notification.title,
      body,
      data,
    })
  const over = (data: Data) => Buffer.byteLength(make(data), "utf8") - maxMessageBytes
  const error = shortenError(notification.data, over)
  const text = over(error) > 0 ? { ...error, text: undefined } : error
  const save = over(text) > 0 ? { ...text, save: undefined } : text
  const data = shortenOptions(shortenResources(save, over), over)
  if (over(data) <= 0) return make(data)
  return make(data, shorten(notification.body, over(data)) ?? "…")
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

    const clear = Effect.fn("PushSender.clear")(function* (ids: ReadonlyArray<string>) {
      const cleared: (typeof Sent.Type & { id: string })[] = []
      for (const id of ids) {
        const sent = yield* getSent(id)
        yield* kv.remove(sentKey(id))
        if (sent) cleared.push({ id, ...sent })
      }
      if (cleared.length === 0) return
      const targets = yield* list.targets()
      const time = yield* Clock.currentTimeMillis
      yield* Effect.forEach(
        cleared.flatMap((item) =>
          targets.devices
            .filter((device) => item.devices.includes(device.id))
            .map((device) =>
              push(device, JSON.stringify({ v: 1, id: item.id, type: "clear", sessionID: item.sessionID, time }), true),
            ),
        ),
        Effect.ignoreCause({ log: "Warn", message: "Failed to clear a push notification" }),
        { concurrency: "unbounded", discard: true },
      )
    })

    const clearSession = Effect.fn("PushSender.clearSession")(function* (sessionID: string) {
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
      yield* clear(ids)
    })

    return Service.of({
      send: (notification) => deliver(notification).pipe(Effect.forkIn(scope), Effect.asVoid),
      clear: (ids) => clear(ids).pipe(Effect.forkIn(scope), Effect.asVoid),
      clearSession: (sessionID) => clearSession(sessionID).pipe(Effect.forkIn(scope), Effect.asVoid),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [PushList.node, KV.node, httpClient] })
