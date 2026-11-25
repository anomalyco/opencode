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
}

/** The first question of a form. */
export interface Question {
  readonly key: string
  readonly type: string
  readonly title?: string
  readonly text?: string
  /** True when a typed answer is accepted besides the options. */
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
  readonly save?: ReadonlyArray<string>
  readonly count?: number
  readonly question?: Question
  readonly outcome?: "succeeded" | "failed"
  readonly text?: string
  readonly error?: { readonly type: string; readonly message?: string }
  /** Something in `data` was cut or left out; the full version can be read by id. */
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
  readonly clear: (ids: ReadonlyArray<string>, time: number) => Effect.Effect<void>
  /** Removes every notification sent for this top-level session, for when the session is deleted. */
  readonly clearSession: (sessionID: string, time: number) => Effect.Effect<void>
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
  const marked = { ...data, truncated: true as const }
  return { ...marked, error: { ...data.error, message: shorten(data.error.message, over(marked)) } }
}

const shortenResources = (data: Data, over: Over) => {
  if (!data.resources?.length || over(data) <= 0) return data
  return cutList(data.resources, (kept) => ({ ...data, resources: kept, truncated: true }), over, shorten)
}

const shortenQuestion = (data: Data, over: Over): Data => {
  const question = data.question
  if (question?.text === undefined || over(data) <= 0) return data
  const marked = { ...data, truncated: true as const }
  return { ...marked, question: { ...question, text: shorten(question.text, over(marked)) } }
}

// A choice is never shortened, since a reply sends it as it is.
const shortenOptions = (data: Data, over: Over) => {
  const question = data.question
  if (!question?.options?.length || over(data) <= 0) return data
  const cut = (kept: ReadonlyArray<Choice>): Data => ({
    ...data,
    question: { ...question, options: kept },
    truncated: true,
  })
  return cutList(question.options, cut, over, () => undefined)
}

/**
 * The JSON the phone decrypts, shortened so the box stays within the relay's limit. Bulk goes before small facts: a
 * turn's text is dropped, then a failed turn's error message is cut, then a permission's resources (its `save` is
 * dropped only when that isn't enough), then the body, a question's text, its options and its title. Anything cut or left out of
 * `data` sets `truncated: true`. Ids are never cut.
 */
export const message = (notification: Notification) => {
  const make = (data: Data, body: string) =>
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
  const overWith = (body: string) => (data: Data) => Buffer.byteLength(make(data, body), "utf8") - maxMessageBytes
  const over = overWith(notification.body)
  const start = notification.data
  const text =
    start.text === undefined || over(start) <= 0 ? start : { ...start, text: undefined, truncated: true as const }
  const error = shortenError(text, over)
  const resources = shortenResources(error, over)
  const save =
    resources.save === undefined || over(resources) <= 0
      ? resources
      : shortenResources({ ...error, save: undefined, truncated: true }, over)
  const body = over(save) <= 0 ? notification.body : (shorten(notification.body, over(save)) ?? "")
  const options = shortenOptions(shortenQuestion(save, overWith(body)), overWith(body))
  const data =
    options.question?.title === undefined || overWith(body)(options) <= 0
      ? options
      : { ...options, question: { ...options.question, title: undefined }, truncated: true as const }
  return make(data, body)
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
            .map((device) =>
              push(device, JSON.stringify({ v: 1, id: item.id, type: "clear", sessionID: item.sessionID, time }), true),
            ),
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
