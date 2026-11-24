export * as PushSender from "./sender.js"

import { Context, Effect, Layer, Scope } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import type { Push } from "@opencode/schema/push"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { PushCrypto } from "./crypto.js"
import { PushList } from "./list.js"

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

/** The JSON the phone decrypts, with the body shortened so the box stays within the relay's limit. */
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
  let body = notification.body
  let text = make(body)
  while (Buffer.byteLength(text, "utf8") > maxMessageBytes && body.length > 1) {
    const over = Buffer.byteLength(text, "utf8") - maxMessageBytes
    const chars = Array.from(body)
    body = chars.slice(0, Math.max(0, chars.length - over - 3)).join("") + "…"
    text = make(body)
  }
  return text
}

export const level = (device: PushList.Stored, sessions: Record<string, Push.Bell>, sessionID: string) =>
  device.sessions[sessionID]?.level ?? sessions[sessionID]?.level ?? device.settings.default

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const list = yield* PushList.Service
    const http = yield* HttpClient.HttpClient
    const scope = yield* Scope.Scope

    const post = (url: string, box: string) =>
      http.execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe({ box }))).pipe(
        Effect.map((response) => response.status),
        Effect.timeout("10 seconds"),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.orElseSucceed(() => undefined),
      )

    const sendTo = Effect.fn("PushSender.sendTo")(function* (
      device: PushList.Stored,
      sessions: Record<string, Push.Bell>,
      notification: Notification,
    ) {
      if (device.paused) return
      const wanted = level(device, sessions, notification.sessionID)
      if (wanted === "none") return
      if (wanted === "attention" && !notification.attention) return
      const box = PushCrypto.seal(device.secret, device.id, message(notification))
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const status = yield* post(device.callbackURL, box)
        if (status === 404 || status === 410) return yield* list.remove(device.id)
        if (status !== undefined && status < 500) return
        if (attempt < attempts) yield* Effect.sleep("1 second")
      }
    })

    const deliver = Effect.fn("PushSender.deliver")(function* (notification: Notification) {
      const targets = yield* list.targets()
      if (targets.settings.paused) return
      yield* Effect.forEach(targets.devices, (device) => sendTo(device, targets.sessions, notification), {
        concurrency: "unbounded",
        discard: true,
      })
    })

    return Service.of({
      send: (notification) => deliver(notification).pipe(Effect.forkIn(scope), Effect.asVoid),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [PushList.node, httpClient] })
