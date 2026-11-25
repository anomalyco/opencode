export * as PushSender from "./sender.js"

import { Context, Effect, Layer, Scope } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import type { Push } from "@opencode/schema/push"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { PushCrypto } from "./crypto.js"
import { PushList } from "./list.js"
import { PushOptions } from "./options.js"

export interface Notification {
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
    const options = yield* PushOptions.Service
    const http = yield* HttpClient.HttpClient
    const scope = yield* Scope.Scope

    const post = (url: string, box: string) =>
      http.execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe({ box }))).pipe(
        Effect.flatMap((response) => response.text.pipe(Effect.ignore, Effect.as(response.status))),
        Effect.timeout("10 seconds"),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
        Effect.orElseSucceed(() => undefined),
      )

    const sendTo = Effect.fn("PushSender.sendTo")(function* (
      device: PushList.Stored,
      sessions: Record<string, Push.Bell>,
      notification: Notification,
      relays: readonly string[],
    ) {
      if (device.paused) return
      if (!relays.includes(new URL(device.callbackURL).origin)) return
      const wanted = level(device, sessions, notification.sessionID)
      if (wanted === "none") return
      if (wanted === "attention" && !notification.attention) return
      const box = PushCrypto.seal(device.secret, device.id, message(notification))
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const status = yield* post(device.callbackURL, box)
        if (status === 404 || status === 410) return yield* list.removeGone(device.id, device.callbackURL)
        if (status !== undefined && status < 300) return
        if (status !== undefined && status < 500)
          return yield* Effect.logWarning("relay rejected a push notification", { deviceID: device.id, status })
        if (attempt < attempts) yield* Effect.sleep("1 second")
      }
      yield* Effect.logWarning("gave up sending a push notification", { deviceID: device.id, attempts })
    })

    const deliver = Effect.fn("PushSender.deliver")(function* (notification: Notification) {
      const targets = yield* list.targets()
      if (targets.settings.paused) return
      const current = yield* options.get()
      yield* Effect.forEach(
        targets.devices,
        (device) =>
          sendTo(device, targets.sessions, notification, current.relays).pipe(
            Effect.ignoreCause({ log: "Warn", message: "Failed to send a push notification" }),
          ),
        { concurrency: "unbounded", discard: true },
      )
    })

    return Service.of({
      send: (notification) => deliver(notification).pipe(Effect.forkIn(scope), Effect.asVoid),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [PushList.node, PushOptions.node, httpClient] })
