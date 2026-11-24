export * as PushList from "./list.js"

import { Clock, Context, Effect, Layer, Option, Schema, Semaphore, Stream } from "effect"
import { Push } from "@opencode/schema/push"
import type { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
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

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("PushList.NotFoundError", {
  id: Push.DeviceID,
}) {
  override get message() {
    return `No phone registered with ID ${this.id}.`
  }
}

export interface Interface {
  readonly register: (
    id: Push.DeviceID,
    input: Push.Register,
    relays: readonly string[],
  ) => Effect.Effect<Push.Registered, InvalidError>
  readonly remove: (id: Push.DeviceID) => Effect.Effect<void>
  /** Removes the phone after its relay answered gone, unless it has registered a new callback URL since. */
  readonly removeGone: (id: Push.DeviceID, callbackURL: string) => Effect.Effect<void>
  readonly hasDevices: () => Effect.Effect<boolean>
  readonly pause: (id: Push.DeviceID, paused: boolean) => Effect.Effect<Push.DevicePatch, NotFoundError>
  readonly setDeviceBell: (
    id: Push.DeviceID,
    sessionID: Session.ID,
    bell: Push.Bell,
  ) => Effect.Effect<Push.Bell, InvalidError | NotFoundError>
  readonly removeDeviceBell: (id: Push.DeviceID, sessionID: Session.ID) => Effect.Effect<void, NotFoundError>
  readonly setSessionBell: (sessionID: Session.ID, bell: Push.Bell) => Effect.Effect<Push.Bell, InvalidError>
  readonly removeSessionBell: (sessionID: Session.ID) => Effect.Effect<void>
  readonly settings: () => Effect.Effect<Push.Settings>
  readonly setSettings: (settings: Push.Settings) => Effect.Effect<Push.Settings, InvalidError>
  readonly info: () => Effect.Effect<Push.Info>
  readonly targets: () => Effect.Effect<Targets>
}

export interface Targets {
  readonly settings: Push.Settings
  readonly devices: readonly Stored[]
  readonly sessions: Record<string, Push.Bell>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PushList") {}

const deviceKey = (id: string) => `push:device:${id}`
const devicePrefix = "push:device:"
const settingsKey = "push:settings"
const sessionKey = (sessionID: string) => `push:session:${sessionID}`
const sessionPrefix = "push:session:"

const decodeStored = Schema.decodeUnknownOption(Stored)
const decodeSettings = Schema.decodeUnknownOption(Push.Settings)
const decodeBell = Schema.decodeUnknownOption(Push.Bell)

const notifyPath = /^\/v2\/notify\/[^/]+$/

const validURL = (callbackURL: string, relays: readonly string[]) => {
  const url = URL.parse(callbackURL)
  if (!url || url.href !== callbackURL) return false
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
    const bus = yield* Bus.Service
    const lock = Semaphore.makeUnsafe(1)

    const changed = bus.publish(Push.Event.Updated, {}, { global: true }).pipe(Effect.asVoid)

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

      const existing = Option.filter(yield* readDevice(id), (stored) => stored.expiresAt > now)
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
        yield* changed
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
      yield* changed
      return { publicKey: stored.serverKey }
    })

    const remove = Effect.fn("PushList.remove")(function* (id: Push.DeviceID) {
      if (Option.isNone(yield* readDevice(id))) return
      yield* kv.remove(deviceKey(id))
      yield* changed
    })

    const removeGone = Effect.fn("PushList.removeGone")(function* (id: Push.DeviceID, callbackURL: string) {
      const stored = yield* readDevice(id)
      if (Option.isNone(stored) || stored.value.callbackURL !== callbackURL) return
      yield* kv.remove(deviceKey(id))
      yield* changed
    })

    const hasDevices = Effect.fn("PushList.hasDevices")(function* () {
      const page = yield* kv.scan({ prefix: devicePrefix, limit: 1 })
      return page.entries.length > 0
    })

    const requireDevice = Effect.fn("PushList.requireDevice")(function* (id: Push.DeviceID) {
      const now = yield* Clock.currentTimeMillis
      const stored = yield* readDevice(id)
      if (Option.isNone(stored) || stored.value.expiresAt <= now) return yield* new NotFoundError({ id })
      return stored.value
    })

    const checkBell = Effect.fn("PushList.checkBell")(function* (bell: Push.Bell) {
      const now = yield* Clock.currentTimeMillis
      if (bell.until !== undefined && bell.until <= now)
        return yield* new InvalidError({ reason: "until must be in the future" })
      return bell
    })

    const pause = Effect.fn("PushList.pause")(function* (id: Push.DeviceID, paused: boolean) {
      const stored = yield* requireDevice(id)
      const now = yield* Clock.currentTimeMillis
      yield* kv.set(deviceKey(id), { ...stored, paused, updatedAt: now })
      yield* changed
      return { paused }
    })

    const setDeviceBell = Effect.fn("PushList.setDeviceBell")(function* (
      id: Push.DeviceID,
      sessionID: Session.ID,
      bell: Push.Bell,
    ) {
      const stored = yield* requireDevice(id)
      const saved = yield* checkBell(bell)
      const now = yield* Clock.currentTimeMillis
      yield* kv.set(deviceKey(id), { ...stored, sessions: { ...stored.sessions, [sessionID]: saved }, updatedAt: now })
      yield* changed
      return saved
    })

    const removeDeviceBell = Effect.fn("PushList.removeDeviceBell")(function* (
      id: Push.DeviceID,
      sessionID: Session.ID,
    ) {
      const stored = yield* requireDevice(id)
      if (!(sessionID in stored.sessions)) return
      const { [sessionID]: _, ...sessions } = stored.sessions
      const now = yield* Clock.currentTimeMillis
      yield* kv.set(deviceKey(id), { ...stored, sessions, updatedAt: now })
      yield* changed
    })

    const setSessionBell = Effect.fn("PushList.setSessionBell")(function* (sessionID: Session.ID, bell: Push.Bell) {
      const saved = yield* checkBell(bell)
      yield* kv.set(sessionKey(sessionID), saved)
      yield* changed
      return saved
    })

    const removeSessionBell = Effect.fn("PushList.removeSessionBell")(function* (sessionID: string) {
      if ((yield* kv.get(sessionKey(sessionID))) === undefined) return
      yield* kv.remove(sessionKey(sessionID))
      yield* changed
    })

    const settings = Effect.fn("PushList.settings")(function* () {
      return yield* readSettings(yield* Clock.currentTimeMillis)
    })

    const setSettings = Effect.fn("PushList.setSettings")(function* (input: Push.Settings) {
      const now = yield* Clock.currentTimeMillis
      if (input.until !== undefined && input.until <= now)
        return yield* new InvalidError({ reason: "until must be in the future" })
      const saved: Push.Settings = input.paused ? input : { paused: false }
      yield* kv.set(settingsKey, saved)
      yield* changed
      return saved
    })

    const forgetSession = Effect.fn("PushList.forgetSession")(function* (sessionID: string) {
      let found = (yield* kv.get(sessionKey(sessionID))) !== undefined
      yield* kv.remove(sessionKey(sessionID))
      for (const stored of yield* readDevices(yield* Clock.currentTimeMillis)) {
        if (!(sessionID in stored.sessions)) continue
        const { [sessionID]: _, ...sessions } = stored.sessions
        yield* kv.set(deviceKey(stored.id), { ...stored, sessions })
        found = true
      }
      if (found) yield* changed
    })

    const targets = Effect.fn("PushList.targets")(function* () {
      const now = yield* Clock.currentTimeMillis
      return {
        settings: yield* readSettings(now),
        devices: yield* readDevices(now),
        sessions: yield* readSessionBells(now),
      }
    })

    yield* bus.subscribe([SessionEvent.Deleted]).pipe(
      Stream.runForEach((event) =>
        lock
          .withPermit(forgetSession(event.data.sessionID))
          .pipe(Effect.ignoreCause({ log: "Warn", message: "Failed to drop push bells for a deleted session" })),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

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
      removeGone: (id, callbackURL) => lock.withPermit(removeGone(id, callbackURL)),
      hasDevices,
      pause: (id, paused) => lock.withPermit(pause(id, paused)),
      setDeviceBell: (id, sessionID, bell) => lock.withPermit(setDeviceBell(id, sessionID, bell)),
      removeDeviceBell: (id, sessionID) => lock.withPermit(removeDeviceBell(id, sessionID)),
      setSessionBell: (sessionID, bell) => lock.withPermit(setSessionBell(sessionID, bell)),
      removeSessionBell: (sessionID) => lock.withPermit(removeSessionBell(sessionID)),
      settings: () => lock.withPermit(settings()),
      setSettings: (input) => lock.withPermit(setSettings(input)),
      info: () => lock.withPermit(info()),
      targets: () => lock.withPermit(targets()),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node, KV.node] })
