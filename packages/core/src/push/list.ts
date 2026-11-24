export * as PushList from "./list.js"

import { Clock, Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { Push } from "@opencode/schema/push"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "../kv.js"
import { PushCrypto } from "./crypto.js"

export interface Stored extends Schema.Schema.Type<typeof Stored> {}
export const Stored = Schema.Struct({
  id: Push.DeviceID,
  name: Schema.String,
  platform: Push.Platform,
  callbackURL: Schema.String,
  expiresAt: Push.Time,
  phoneKey: Schema.String,
  serverKey: Schema.String,
  secret: Schema.String,
  settings: Push.DeviceSettings,
  sessions: Schema.Record(Schema.String, Push.Bell),
  paused: Schema.Boolean,
  createdAt: Push.Time,
  updatedAt: Push.Time,
})

export class InvalidError extends Schema.TaggedError<InvalidError>()("PushList.InvalidError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export interface Interface {
  readonly register: (
    id: Push.DeviceID,
    input: Push.Register,
    relays: readonly string[],
  ) => Effect.Effect<Push.Registered, InvalidError>
  readonly remove: (id: Push.DeviceID) => Effect.Effect<void>
  readonly info: () => Effect.Effect<Push.Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PushList") {}

const deviceKey = (id: string) => `push:device:${id}`
const devicePrefix = "push:device:"
const settingsKey = "push:settings"
const sessionPrefix = "push:session:"

const decodeStored = Schema.decodeUnknownOption(Stored)
const decodeSettings = Schema.decodeUnknownOption(Push.Settings)
const decodeBell = Schema.decodeUnknownOption(Push.Bell)

const notifyPath = /^\/v2\/notify\/[^/]+$/

const validURL = (callbackURL: string, relays: readonly string[]) => {
  const url = URL.parse(callbackURL)
  if (!url) return false
  if (url.protocol !== "https:") return false
  if (url.username || url.password || url.search || url.hash) return false
  if (!relays.includes(url.origin)) return false
  return notifyPath.test(url.pathname)
}

const liveBells = (bells: Record<string, Push.Bell>, now: number) => {
  const live: Record<string, Push.Bell> = {}
  for (const [sessionID, bell] of Object.entries(bells)) {
    if (bell.until !== undefined && bell.until <= now) continue
    live[sessionID] = bell
  }
  return live
}

export const toDevice = (stored: Stored): Push.Device => ({
  id: stored.id,
  name: stored.name,
  platform: stored.platform,
  expiresAt: stored.expiresAt,
  settings: stored.settings,
  paused: stored.paused,
  sessions: stored.sessions,
  time: { created: stored.createdAt, updated: stored.updatedAt },
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const lock = Semaphore.makeUnsafe(1)

    const scan = Effect.fn("PushList.scan")(function* (prefix: string) {
      const entries: KV.Entry[] = []
      let after: string | undefined
      while (true) {
        const page = yield* kv.scan({ prefix, after, limit: 1000 })
        entries.push(...page.entries)
        if (!page.next) return entries
        after = page.next
      }
    })

    const readDevice = Effect.fn("PushList.readDevice")(function* (id: string) {
      return decodeStored(yield* kv.get(deviceKey(id)))
    })

    const readDevices = Effect.fn("PushList.readDevices")(function* (now: number) {
      const devices: Stored[] = []
      for (const entry of yield* scan(devicePrefix)) {
        const stored = decodeStored(entry.value)
        if (Option.isNone(stored) || stored.value.expiresAt <= now) {
          yield* kv.remove(entry.key)
          continue
        }
        const sessions = liveBells(stored.value.sessions, now)
        if (Object.keys(sessions).length === Object.keys(stored.value.sessions).length) {
          devices.push(stored.value)
          continue
        }
        const cleaned = { ...stored.value, sessions }
        yield* kv.set(entry.key, cleaned)
        devices.push(cleaned)
      }
      return devices
    })

    const readSettings = Effect.fn("PushList.readSettings")(function* (now: number) {
      const settings = decodeSettings(yield* kv.get(settingsKey))
      if (Option.isNone(settings)) return { paused: false } satisfies Push.Settings
      if (settings.value.until === undefined || settings.value.until > now) return settings.value
      yield* kv.remove(settingsKey)
      return { paused: false } satisfies Push.Settings
    })

    const readSessionBells = Effect.fn("PushList.readSessionBells")(function* (now: number) {
      const bells: Record<string, Push.Bell> = {}
      for (const entry of yield* scan(sessionPrefix)) {
        const bell = decodeBell(entry.value)
        if (Option.isNone(bell) || (bell.value.until !== undefined && bell.value.until <= now)) {
          yield* kv.remove(entry.key)
          continue
        }
        bells[entry.key.slice(sessionPrefix.length)] = bell.value
      }
      return bells
    })

    const register = Effect.fn("PushList.register")(function* (
      id: Push.DeviceID,
      input: Push.Register,
      relays: readonly string[],
    ) {
      const now = yield* Clock.currentTimeMillis
      if (!validURL(input.callbackURL, relays))
        return yield* new InvalidError({
          reason: "callbackURL must be a /v2/notify/ URL on a relay this server allows",
        })
      if (input.expiresAt <= now) return yield* new InvalidError({ reason: "expiresAt must be in the future" })

      const existing = yield* readDevice(id)
      const settings = input.settings ?? { default: "all" }
      if (Option.isSome(existing) && existing.value.phoneKey === input.publicKey) {
        yield* kv.set(deviceKey(id), {
          ...existing.value,
          name: input.name,
          platform: input.platform,
          callbackURL: input.callbackURL,
          expiresAt: input.expiresAt,
          settings,
          updatedAt: now,
        })
        yield* readDevices(now)
        return { publicKey: existing.value.serverKey }
      }

      const agreement = yield* PushCrypto.agree(PushCrypto.newServerKey(), input.publicKey, id)
      if (Option.isNone(agreement))
        return yield* new InvalidError({ reason: "publicKey must be a base64 uncompressed P-256 public key" })
      const stored: Stored = {
        id,
        name: input.name,
        platform: input.platform,
        callbackURL: input.callbackURL,
        expiresAt: input.expiresAt,
        phoneKey: input.publicKey,
        serverKey: agreement.value.serverKey,
        secret: agreement.value.secret,
        settings,
        sessions: Option.isSome(existing) ? existing.value.sessions : {},
        paused: Option.isSome(existing) ? existing.value.paused : false,
        createdAt: Option.isSome(existing) ? existing.value.createdAt : now,
        updatedAt: now,
      }
      yield* kv.set(deviceKey(id), stored)
      yield* readDevices(now)
      return { publicKey: stored.serverKey }
    })

    const remove = Effect.fn("PushList.remove")(function* (id: Push.DeviceID) {
      yield* kv.remove(deviceKey(id))
    })

    const info = Effect.fn("PushList.info")(function* () {
      const now = yield* Clock.currentTimeMillis
      return {
        settings: yield* readSettings(now),
        devices: (yield* readDevices(now)).map(toDevice),
        sessions: yield* readSessionBells(now),
      }
    })

    return Service.of({
      register: (id, input, relays) => lock.withPermit(register(id, input, relays)),
      remove: (id) => lock.withPermit(remove(id)),
      info: () => lock.withPermit(info()),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
