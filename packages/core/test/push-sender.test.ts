import { beforeEach, describe, expect } from "bun:test"
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto"
import { Effect, Layer } from "effect"
import { KV } from "@opencode/core/kv"
import { Bus } from "@opencode/core/bus"
import { PushCrypto } from "@opencode/core/push/crypto"
import { PushList } from "@opencode/core/push/list"
import { PushOptions } from "@opencode/core/push/options"
import { PushSender } from "@opencode/core/push/sender"
import { Push } from "@opencode/schema/push"
import { Session } from "@opencode/schema/session"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { advance, drain } from "./lib/clock"
import { testEffect } from "./lib/effect"

interface Call {
  readonly origin: string
  readonly path: string
  readonly box: string
  readonly redirect?: RequestInit["redirect"]
}

let calls: Call[] = []

const relay = async (input: Request | string | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input)
  const path = url.pathname
  const text = input instanceof Request ? await input.text() : String(init?.body)
  calls.push({ origin: url.origin, path, box: JSON.parse(text).box, redirect: init?.redirect })
  if (path.endsWith("/gone")) return new Response('{"status":"gone"}', { status: 410 })
  if (path.endsWith("/missing")) return new Response("", { status: 404 })
  if (path.endsWith("/busy")) return new Response("", { status: 429 })
  if (path.endsWith("/broken")) return new Response("", { status: 503 })
  return new Response('{"status":"accepted"}', { status: 202 })
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([PushSender.node, PushList.node, KV.node, Bus.node]), {
    replacements: [
      LayerNodePlatform.httpFetch.replace(LayerNodePlatform.fetchLayer(relay)),
      PushOptions.node.replace(
        Layer.succeed(
          PushOptions.Service,
          PushOptions.Service.of({
            get: () => Effect.succeed({ enabled: true, relays: [PushOptions.defaultRelay] }),
          }),
        ),
      ),
    ],
  }),
)

const sessionID = Session.ID.make("ses_push_sender")
const removedRelay = "https://removed-relay.example.com"
const relays = [PushOptions.defaultRelay, removedRelay]

const finished: PushSender.Notification = {
  type: "session.idle",
  sessionID,
  title: "Fix the login bug",
  body: "Finished",
  data: { outcome: "succeeded" },
  attention: false,
}

const question: PushSender.Notification = {
  type: "question",
  sessionID,
  title: "Fix the login bug",
  body: "Which database?",
  data: { formID: "frm_1" },
  attention: true,
}

const phone = Effect.fn(function* (
  id: string,
  path: string,
  settings?: Push.DeviceSettings,
  origin = PushOptions.defaultRelay,
) {
  const list = yield* PushList.Service
  const keys = createECDH("prime256v1")
  keys.generateKeys()
  const registered = yield* list.register(
    Push.DeviceID.make(id),
    {
      callbackURL: `${origin}/v2/notify/${path}`,
      expiresAt: Date.now() + 86_400_000,
      publicKey: keys.getPublicKey("base64"),
      platform: "android",
      name: path,
      settings,
    },
    relays,
  )
  return { id, keys, serverKey: registered.publicKey }
})

const open = (phone: { id: string; keys: ReturnType<typeof createECDH>; serverKey: string }, box: string) => {
  const shared = phone.keys.computeSecret(Buffer.from(phone.serverKey, "base64"))
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.from(phone.id, "utf8"), PushCrypto.context, 32))
  const bytes = Buffer.from(box, "base64")
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12))
  decipher.setAAD(Buffer.from(`${PushCrypto.context}:${phone.id}`, "utf8"))
  decipher.setAuthTag(bytes.subarray(bytes.length - 16))
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString(),
  )
}

const ids = {
  ok: "00000000-0000-4000-8000-000000000001",
  gone: "00000000-0000-4000-8000-000000000002",
  broken: "00000000-0000-4000-8000-000000000003",
  quiet: "00000000-0000-4000-8000-000000000004",
  missing: "00000000-0000-4000-8000-000000000005",
  busy: "00000000-0000-4000-8000-000000000006",
  removed: "00000000-0000-4000-8000-000000000007",
}

beforeEach(() => {
  calls = []
})

describe("PushCrypto", () => {
  it.effect("seals the same box as the Android app for its known keys", () =>
    Effect.sync(() => {
      const server = createECDH("prime256v1")
      server.setPrivateKey(Buffer.alloc(32, 0).fill(2, 31))
      expect(server.getPublicKey("base64")).toBe(
        "BHzyexiNA09+ilI4AwS1GsPAiWnid/IbNaYLSPxHZpl4B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E=",
      )
      const phoneKey = createECDH("prime256v1")
      phoneKey.setPrivateKey(Buffer.alloc(32, 0).fill(1, 31))
      const ref = "12345678-1234-1234-1234-123456789abc"
      const agreement = PushCrypto.agree(server, phoneKey.getPublicKey("base64"), ref)
      if (agreement._tag === "None") throw new Error("no agreement")
      const plaintext = '{"title":"Ready ✓","body":"A private result.","sessionID":"ses_interop","status":"succeeded"}'
      const nonce = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      expect(PushCrypto.seal(agreement.value.secret, ref, plaintext, nonce)).toBe(
        "AAECAwQFBgcICQoLC4dJyQruN1/zqsh/R/xDql8IOBGM6LrqRHv2TWWhg6SckoCRnM4Via3Ut8PuKBcnmgv5Cdv/yeOoUC/38P5ewf6O/jRfz49VMw8i4VvesvFmd8H8cN/N/YKJw2fd/yHT3bVOTwVKrJEpuEP3ljI3",
      )
    }),
  )
})

describe("PushSender", () => {
  it.effect("sends an encrypted notification, removes gone phones and retries failing relays twice", () =>
    Effect.gen(function* () {
      const sender = yield* PushSender.Service
      const list = yield* PushList.Service
      const ok = yield* phone(ids.ok, "ok")
      yield* phone(ids.gone, "gone")
      yield* phone(ids.missing, "missing")
      yield* phone(ids.busy, "busy")
      yield* phone(ids.broken, "broken")
      yield* phone(ids.quiet, "quiet", { default: "attention" })
      yield* phone(ids.removed, "removed", undefined, removedRelay)

      yield* sender.send(finished)
      yield* advance(() => calls.filter((call) => call.path.endsWith("/broken")).length === 3)
      yield* drain

      expect(calls.filter((call) => call.path.endsWith("/quiet"))).toEqual([])
      expect(calls.filter((call) => call.origin === removedRelay)).toEqual([])
      expect(calls.filter((call) => call.path.endsWith("/busy"))).toHaveLength(1)
      expect(calls.filter((call) => call.path.endsWith("/broken"))).toHaveLength(3)
      expect(calls.every((call) => call.redirect === "manual")).toBe(true)
      const delivered = calls.find((call) => call.path.endsWith("/ok"))
      expect(open(ok, delivered!.box)).toEqual({
        v: 1,
        type: "session.idle",
        sessionID,
        title: "Fix the login bug",
        body: "Finished",
        data: { outcome: "succeeded" },
      })
      const devices = (yield* list.info()).devices.map((device) => device.id)
      expect(devices.toSorted()).toEqual([ids.ok, ids.broken, ids.quiet, ids.busy, ids.removed].toSorted())
    }),
  )

  it.effect("follows pauses, then the phone's bell, the shared bell and the phone's default", () =>
    Effect.gen(function* () {
      const sender = yield* PushSender.Service
      const list = yield* PushList.Service
      yield* phone(ids.ok, "ok")
      yield* phone(ids.quiet, "quiet", { default: "attention" })
      const sent = (path: string) => calls.filter((call) => call.path.endsWith(path)).length

      yield* list.setSessionBell(sessionID, { level: "none" })
      yield* list.setDeviceBell(Push.DeviceID.make(ids.quiet), sessionID, { level: "all" })
      yield* sender.send(finished)
      yield* advance(() => sent("/quiet") === 1)

      yield* list.update(Push.DeviceID.make(ids.quiet), { paused: true })
      yield* list.removeSessionBell(sessionID)
      yield* sender.send(question)
      yield* advance(() => sent("/ok") === 1)

      yield* list.setSettings({ paused: true })
      yield* sender.send(question)
      yield* drain
      expect(calls.map((call) => call.path.split("/").pop())).toEqual(["quiet", "ok"])
    }),
  )

  it.effect("shortens a long body so the box fits the relay", () =>
    Effect.sync(() => {
      for (const body of ["é".repeat(5_000), "漢".repeat(1_500), "\n".repeat(3_000)]) {
        const text = PushSender.message({ ...question, body })
        expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(2600)
        expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(2580)
        expect(JSON.parse(text).body.endsWith("…")).toBe(true)
      }
      expect(PushSender.message(question)).toBe(
        JSON.stringify({
          v: 1,
          type: "question",
          sessionID,
          title: question.title,
          body: question.body,
          data: question.data,
        }),
      )
    }),
  )
})
