import { describe, expect } from "bun:test"
import { createECDH } from "node:crypto"
import { Effect, Exit } from "effect"
import { TestClock } from "effect/testing"
import { KV } from "@opencode/core/kv"
import { PushList } from "@opencode/core/push/list"
import { PushOptions } from "@opencode/core/push/options"
import { Push } from "@opencode/schema/push"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([PushList.node, KV.node])))

const id = Push.DeviceID.make("12345678-1234-1234-1234-123456789abc")
const relays = [PushOptions.defaultRelay]
const callbackURL = `${PushOptions.defaultRelay}/v2/notify/sealed-ref`

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
      const registered = yield* list.register(id, input(phoneKey()), relays)
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
      const first = yield* list.register(id, input(key), relays)
      yield* TestClock.adjust(1_000)
      const renewed = yield* list.register(
        id,
        { ...input(key), name: "Pixel 9", expiresAt: 20_000, settings: { default: "attention" } },
        relays,
      )
      expect(renewed.publicKey).toBe(first.publicKey)

      const [device] = (yield* list.info()).devices
      expect(device.name).toBe("Pixel 9")
      expect(device.expiresAt).toBe(20_000)
      expect(device.settings).toEqual({ default: "attention" })
      expect(device.time).toEqual({ created: 0, updated: 1_000 })

      const replaced = yield* list.register(id, input(phoneKey()), relays)
      expect(replaced.publicKey).not.toBe(first.publicKey)
    }),
  )

  it.effect("rejects callback URLs outside the allowed relays and bad phone keys", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const key = phoneKey()
      const urls = [
        "http://opencode-notify-relay.anomalyco.workers.dev/v2/notify/x",
        "https://relay.example.com/v2/notify/x",
        `${PushOptions.defaultRelay}/v1/notify/x`,
        `${PushOptions.defaultRelay}/v2/notify/x?debug=1`,
        "https://user:pass@opencode-notify-relay.anomalyco.workers.dev/v2/notify/x",
      ]
      for (const url of urls) {
        const exit = yield* list.register(id, { ...input(key), callbackURL: url }, relays).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }
      const badKey = yield* list.register(id, input(Buffer.alloc(65, 4).toString("base64")), relays).pipe(Effect.exit)
      expect(Exit.isFailure(badKey)).toBe(true)
      const past = yield* list.register(id, { ...input(key), expiresAt: 0 }, relays).pipe(Effect.exit)
      expect(Exit.isFailure(past)).toBe(true)
      expect((yield* list.info()).devices).toEqual([])
    }),
  )

  it.effect("drops phones whose callback URL has expired and removes phones on request", () =>
    Effect.gen(function* () {
      const list = yield* PushList.Service
      const kv = yield* KV.Service
      yield* list.register(id, input(phoneKey()), relays)
      yield* TestClock.adjust(10_000)
      expect((yield* list.info()).devices).toEqual([])
      expect(yield* kv.get(`push:device:${id}`)).toBeUndefined()

      yield* list.register(id, { ...input(phoneKey()), expiresAt: 50_000 }, relays)
      yield* list.remove(id)
      yield* list.remove(id)
      expect((yield* list.info()).devices).toEqual([])
    }),
  )
})
