export * as PushSender from "./sender.js"

import { Context, Effect, Layer, Scope } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import type { Push } from "@opencode/schema/push"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { PushCrypto } from "./crypto.js"
import { PushList } from "./list.js"

export interface Notification {
  /** What a later `clear` names: the permission request, the form, or the session for a finished turn. */
  readonly id: string
  readonly type: "session.idle" | "question" | "permission"
  readonly sessionID: string
  readonly title: string
  readonly body: string
  readonly data: Record<string, string>
  /** True when the notification needs the person, so phones at level `attention` get it. */
  readonly attention: boolean
}

export interface Interface {
  /** Sends to every phone that wants it, in the background. */
  readonly send: (notification: Notification) => Effect.Effect<void>
  /** Removes the notifications sent under these ids from the phones that got them, in the background. */
  readonly clear: (ids: ReadonlyArray<string>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PushSender") {}

const maxMessageBytes = 2600
const attempts = 3

/** Drops characters from the end of `text` until its JSON is at least `bytes` shorter, then adds "…". */
const shorten = (text: string, bytes: number) => {
  const chars = Array.from(text)
  let dropped = 0
  while (chars.length > 0 && dropped < bytes + 3) {
    dropped += Buffer.byteLength(JSON.stringify(chars.pop()), "utf8") - 2
  }
  return chars.join("") + "…"
}

/**
 * The JSON the phone decrypts, with the body shortened so the box stays within the relay's limit. Only the body can be
 * long: a question's text is free-form, while titles are short and `data` holds ids and names.
 */
export const message = (notification: Notification) => {
  const make = (body: string) =>
    JSON.stringify({
      v: 1,
      id: notification.id,
      type: notification.type,
      sessionID: notification.sessionID,
      title: notification.title,
      body,
      data: notification.data,
    })
  const over = Buffer.byteLength(make(notification.body), "utf8") - maxMessageBytes
  if (over <= 0) return make(notification.body)
  return make(shorten(notification.body, over))
}

export const level = (device: PushList.Stored, sessions: Record<string, Push.Bell>, sessionID: string) =>
  device.sessions[sessionID]?.level ?? sessions[sessionID]?.level ?? device.settings.default

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const list = yield* PushList.Service
    const http = yield* HttpClient.HttpClient
    const scope = yield* Scope.Scope

    // Which phones were sent each notification, so a clear goes only to them. Lost on restart, when the phone keeps
    // the notification until the app is opened.
    const sent = new Map<string, { sessionID: string; devices: Set<string> }>()

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

    const sendTo = Effect.fn("PushSender.sendTo")(function* (
      device: PushList.Stored,
      sessions: Record<string, Push.Bell>,
      notification: Notification,
    ) {
      if (device.paused) return
      const wanted = level(device, sessions, notification.sessionID)
      if (wanted === "none") return
      if (wanted === "attention" && !notification.attention) return
      const entry = sent.get(notification.id) ?? { sessionID: notification.sessionID, devices: new Set() }
      entry.devices.add(device.id)
      sent.set(notification.id, entry)
      yield* push(device, message(notification), false)
    })

    const deliver = Effect.fn("PushSender.deliver")(function* (notification: Notification) {
      const targets = yield* list.targets()
      if (targets.settings.paused) return
      yield* Effect.forEach(
        targets.devices,
        (device) =>
          sendTo(device, targets.sessions, notification).pipe(
            Effect.ignoreCause({ log: "Warn", message: "Failed to send a push notification" }),
          ),
        { concurrency: "unbounded", discard: true },
      )
    })

    const clear = Effect.fn("PushSender.clear")(function* (ids: ReadonlyArray<string>) {
      const cleared = ids.flatMap((id) => {
        const entry = sent.get(id)
        sent.delete(id)
        return entry ? [{ id, ...entry }] : []
      })
      if (cleared.length === 0) return
      const targets = yield* list.targets()
      yield* Effect.forEach(
        cleared.flatMap((item) =>
          targets.devices
            .filter((device) => item.devices.has(device.id))
            .map((device) =>
              push(device, JSON.stringify({ v: 1, id: item.id, type: "clear", sessionID: item.sessionID }), true),
            ),
        ),
        Effect.ignoreCause({ log: "Warn", message: "Failed to clear a push notification" }),
        { concurrency: "unbounded", discard: true },
      )
    })

    return Service.of({
      send: (notification) => deliver(notification).pipe(Effect.forkIn(scope), Effect.asVoid),
      clear: (ids) => clear(ids).pipe(Effect.forkIn(scope), Effect.asVoid),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [PushList.node, httpClient] })
