import { describe, expect } from "bun:test"
import { createECDH } from "node:crypto"
import { Effect, Exit, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { PushList } from "@opencode/core/push/list"
import { Push } from "@opencode/schema/push"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { waitUntil } from "./lib/eventually"

const it = testEffect(LayerNode.compile(LayerNode.group([PushList.node, KV.node, Bus.node])))

const id = Push.DeviceID.make("12345678-1234-1234-1234-123456789abc")
const sessionID = Session.ID.make("ses_push_bells")
const callbackURL = `${PushList.relays[0]}/v2/notify/sealed-ref`

const phoneKey = () => {
  const phone = createECDH("prime256v1")
  phone.generateKeys()
  return phone.getPublicKey("base64")
}

const input = (publicKey: string): Push.Register => ({
  callbackURL,
  expiresAt: 10_000,
  publicKey,
  platform: "android",
  name: "Pixel",
})

describe("PushList", () => {
  it.effect("registers a phone and lists it without its URL or keys", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const registered = yield* list.register(id, input(phoneKey()))
      expect(Buffer.from(registered.publicKey, "base64")).toHaveLength(65)

      expect(yield* list.info()).toEqual({
        settings: { paused: false },
        devices: [
          {
            id,
            name: "Pixel",
            platform: "android",
            expiresAt: 10_000,
            settings: { default: "all" },
            paused: false,
            sessions: {},
            time: { created: 0, updated: 0 },
          },
        ],
        sessions: {},
      })
    }),
  )

  it.effect("keeps the server key for the same phone key and makes a new one for a new phone key", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const key = phoneKey()
      const first = yield* list.register(id, input(key))
      yield* TestClock.adjust(1_000)
      const renewed = yield* list.register(id, {
        ...input(key),
        name: "Pixel 9",
        expiresAt: 20_000,
        settings: { default: "attention" },
      })
      expect(renewed.publicKey).toBe(first.publicKey)

      const [device] = (yield* list.info()).devices
      expect(device.name).toBe("Pixel 9")
      expect(device.expiresAt).toBe(20_000)
      expect(device.settings).toEqual({ default: "attention" })
      expect(device.time).toEqual({ created: 0, updated: 1_000 })

      const replaced = yield* list.register(id, input(phoneKey()))
      expect(replaced.publicKey).not.toBe(first.publicKey)
    }),
  )

  it.effect("accepts callback URLs on the production and dev relays", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      expect(PushList.relays).toHaveLength(2)
      for (const relay of PushList.relays) {
        yield* list.register(id, { ...input(phoneKey()), callbackURL: `${relay}/v2/notify/x` })
      }
    }),
  )

  it.effect("rejects callback URLs off the relays and bad phone keys", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const key = phoneKey()
      const urls = [
        "http://opencode-notify-relay.anomalyco.workers.dev/v2/notify/x",
        "https://relay.example.com/v2/notify/x",
        `${PushList.relays[0]}/v1/notify/x`,
        `${PushList.relays[0]}/v2/notify/x?debug=1`,
        `${PushList.relays[0]}/v2/notify/x.`,
        "https://user:pass@opencode-notify-relay.anomalyco.workers.dev/v2/notify/x",
      ]
      for (const url of urls) {
        const exit = yield* list.register(id, { ...input(key), callbackURL: url }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }
      const badKey = yield* list.register(id, input(Buffer.alloc(65, 4).toString("base64"))).pipe(Effect.exit)
      expect(Exit.isFailure(badKey)).toBe(true)
      const past = yield* list.register(id, { ...input(key), expiresAt: 0 }).pipe(Effect.exit)
      expect(Exit.isFailure(past)).toBe(true)
      expect((yield* list.info()).devices).toEqual([])
    }),
  )

  it.effect("drops phones whose callback URL has expired and removes phones on request", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const kv = yield* KV.Service
      yield* list.register(id, input(phoneKey()))
      yield* TestClock.adjust(10_000)
      expect((yield* list.info()).devices).toEqual([])
      expect(yield* kv.get(`push:device:${id}`)).toBeUndefined()

      yield* list.register(id, { ...input(phoneKey()), expiresAt: 50_000 })
      yield* list.remove(id)
      yield* list.remove(id)
      expect((yield* list.info()).devices).toEqual([])
    }),
  )

  it.effect("removes a gone phone only while it still has the URL that was gone", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      yield* list.register(id, input(phoneKey()))
      yield* list.register(id, { ...input(phoneKey()), callbackURL: `${callbackURL}-renewed` })
      yield* list.removeGone(id, callbackURL)
      expect((yield* list.info()).devices).toHaveLength(1)

      yield* list.removeGone(id, `${callbackURL}-renewed`)
      expect((yield* list.info()).devices).toEqual([])
    }),
  )

  it.effect("starts afresh when a phone registers over its own expired entry", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const key = phoneKey()
      const first = yield* list.register(id, input(key))
      yield* list.update(id, { paused: true })
      yield* TestClock.adjust(10_000)
      const again = yield* list.register(id, { ...input(key), expiresAt: 50_000 })
      expect(again.publicKey).not.toBe(first.publicKey)
      expect((yield* list.info()).devices[0].paused).toBe(false)
    }),
  )

  it.effect("keeps a phone's pause, level and bells when it registers again", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      yield* list.register(id, input(phoneKey()))
      expect((yield* list.update(id, { paused: true })).paused).toBe(true)
      const updated = yield* list.update(id, { settings: { default: "attention" } })
      expect(updated.paused).toBe(true)
      expect(updated.settings).toEqual({ default: "attention" })
      expect(yield* list.setDeviceBell(id, sessionID, { level: "none", until: 5_000 })).toEqual({
        level: "none",
        until: 5_000,
      })
      yield* list.register(id, input(phoneKey()))

      const [device] = (yield* list.info()).devices
      expect(device.paused).toBe(true)
      expect(device.settings).toEqual({ default: "attention" })
      expect(device.sessions).toEqual({ [sessionID]: { level: "none", until: 5_000 } })

      yield* TestClock.adjust(5_000)
      expect((yield* list.info()).devices[0].sessions).toEqual({})

      yield* list.register(id, { ...input(phoneKey()), settings: { default: "none" } })
      expect((yield* list.info()).devices[0].settings).toEqual({ default: "none" })
    }),
  )

  it.effect("answers not found for an unknown phone and rejects a past until", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const pause = yield* list.update(id, { paused: true }).pipe(Effect.flip)
      expect(pause._tag).toBe("PushList.NotFoundError")
      const bell = yield* list.setDeviceBell(id, sessionID, { level: "all" }).pipe(Effect.flip)
      expect(bell._tag).toBe("PushList.NotFoundError")
      const clear = yield* list.removeDeviceBell(id, sessionID).pipe(Effect.flip)
      expect(clear._tag).toBe("PushList.NotFoundError")

      yield* TestClock.adjust(1_000)
      const past = yield* list.setSessionBell(sessionID, { level: "none", until: 1_000 }).pipe(Effect.flip)
      expect(past._tag).toBe("PushList.InvalidError")
      const pastPause = yield* list.setSettings({ paused: true, until: 500 }).pipe(Effect.flip)
      expect(pastPause._tag).toBe("PushList.InvalidError")
    }),
  )

  it.effect("pauses everything until a time", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      expect((yield* list.info()).settings).toEqual({ paused: false })
      expect(yield* list.setSettings({ paused: true, until: 2_000 })).toEqual({ paused: true, until: 2_000 })
      expect((yield* list.info()).settings).toEqual({ paused: true, until: 2_000 })
      yield* TestClock.adjust(2_000)
      expect((yield* list.info()).settings).toEqual({ paused: false })
      expect(yield* list.setSettings({ paused: false, until: 9_000 })).toEqual({ paused: false })
      expect(yield* list.setSettings({ paused: false, until: 1_000 })).toEqual({ paused: false })
    }),
  )

  it.effect("leaves expired bells out of an updated phone", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      yield* list.register(id, input(phoneKey()))
      yield* list.setDeviceBell(id, sessionID, { level: "none", until: 5_000 })
      yield* TestClock.adjust(5_000)
      expect((yield* list.update(id, { paused: true })).sessions).toEqual({})
    }),
  )

  it.effect("drops a deleted session's bells and tells clients about every change", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const bus = yield* Bus.Service
      let updates = 0
      yield* bus.subscribe(Push.Event.Updated).pipe(
        Stream.runForEach(() => Effect.sync(() => updates++)),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* list.register(id, input(phoneKey()))
      yield* list.setDeviceBell(id, sessionID, { level: "attention" })
      yield* list.setSessionBell(sessionID, { level: "none" })
      expect((yield* list.info()).sessions).toEqual({ [sessionID]: { level: "none" } })
      yield* waitUntil(Effect.sync(() => updates === 3))

      yield* bus.publish(SessionEvent.Deleted, { sessionID })
      yield* waitUntil(Effect.sync(() => updates === 4))
      const info = yield* list.info()
      expect(info.sessions).toEqual({})
      expect(info.devices[0].sessions).toEqual({})

      yield* list.removeSessionBell(sessionID)
      yield* list.removeDeviceBell(id, sessionID)
      yield* list.remove(id)
      yield* waitUntil(Effect.sync(() => updates === 5))
    }),
  )
})
