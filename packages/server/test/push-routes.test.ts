import { expect } from "bun:test"
import { createECDH } from "node:crypto"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const authorization = `Basic ${btoa("opencode:secret")}`
const id = "12345678-1234-1234-1234-123456789abc"
const devRelay = "https://notify.dev.opencode.ai"

const start = Effect.fnUntraced(function* (push: boolean) {
  const directory = (yield* tmpdirScoped("opencode-push-routes-")).path
  const started = yield* ServerProcess.start<never, never>({
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
    models: { fetch: false },
    config: {
      directory,
      project: false,
      content: JSON.stringify({ experimental: { push, push_relays: [devRelay] } }),
    },
    fs: { filewatcher: false },
    hostname: "127.0.0.1",
    port: 0,
  })
  const base = HttpServer.formatAddress(started.address)
  return (path: string, init: RequestInit = {}) =>
    Effect.promise(async () => {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { authorization, "content-type": "application/json" },
      })
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : undefined }
    })
})

const register = (publicKey: string, callbackURL = `${devRelay}/v2/notify/sealed`) =>
  JSON.stringify({ callbackURL, expiresAt: Date.now() + 86_400_000, publicKey, platform: "android", name: "Pixel" })

const phoneKey = () => {
  const phone = createECDH("prime256v1")
  phone.generateKeys()
  return phone.getPublicKey("base64")
}

it.live("refuses every push route when the flag is off", () =>
  Effect.gen(function* () {
    const request = yield* start(false)
    expect((yield* request("/api/experimental/push")).status).toBe(403)
    expect(
      (yield* request(`/api/experimental/push/device/${id}`, { method: "PUT", body: register(phoneKey()) })).status,
    ).toBe(403)
    expect((yield* request(`/api/experimental/push/device/${id}`, { method: "DELETE" })).status).toBe(403)
  }),
)

it.live("registers, lists and removes a phone", () =>
  Effect.gen(function* () {
    const request = yield* start(true)
    expect((yield* request("/api/experimental/push")).body.data.relays).toEqual([
      "https://opencode-notify-relay.anomalyco.workers.dev",
      devRelay,
    ])

    const registered = yield* request(`/api/experimental/push/device/${id}`, {
      method: "PUT",
      body: register(phoneKey()),
    })
    expect(registered.status).toBe(200)
    expect(Buffer.from(registered.body.data.publicKey, "base64")).toHaveLength(65)

    const listed = yield* request("/api/experimental/push")
    expect(listed.body.data.devices.map((device: { id: string }) => device.id)).toEqual([id])
    expect(JSON.stringify(listed.body)).not.toContain("/v2/notify")
    expect(JSON.stringify(listed.body)).not.toContain(registered.body.data.publicKey)

    const badURL = yield* request(`/api/experimental/push/device/${id}`, {
      method: "PUT",
      body: register(phoneKey(), "https://relay.example.com/v2/notify/sealed"),
    })
    expect(badURL.status).toBe(400)
    const badID = yield* request("/api/experimental/push/device/NOT-A-UUID", {
      method: "PUT",
      body: register(phoneKey()),
    })
    expect(badID.status).toBe(400)

    expect((yield* request(`/api/experimental/push/device/${id}`, { method: "DELETE" })).status).toBe(204)
    expect((yield* request(`/api/experimental/push/device/${id}`, { method: "DELETE" })).status).toBe(204)
    expect((yield* request("/api/experimental/push")).body.data.devices).toEqual([])
  }),
)

it.live("updates phones and sets session bells", () =>
  Effect.gen(function* () {
    const request = yield* start(true)
    const device = `/api/experimental/push/device/${id}`
    const until = Date.now() + 3_600_000

    const unknown = yield* request(device, { method: "PATCH", body: JSON.stringify({ paused: true }) })
    expect(unknown.status).toBe(404)
    expect(unknown.body.deviceID).toBe(id)
    expect(
      (yield* request(`${device}/session/ses_push`, { method: "PUT", body: JSON.stringify({ level: "none" }) })).status,
    ).toBe(404)

    yield* request(device, { method: "PUT", body: register(phoneKey()) })
    const paused = yield* request(device, { method: "PATCH", body: JSON.stringify({ paused: true }) })
    expect(paused.body.data.paused).toBe(true)
    expect(paused.body.data.settings).toEqual({ default: "all" })
    const quieter = yield* request(device, {
      method: "PATCH",
      body: JSON.stringify({ settings: { default: "attention" } }),
    })
    expect(quieter.body.data.paused).toBe(true)
    expect(quieter.body.data.settings).toEqual({ default: "attention" })
    const bell = yield* request(`${device}/session/ses_push`, {
      method: "PUT",
      body: JSON.stringify({ level: "attention", until }),
    })
    expect(bell.body.data).toEqual({ level: "attention", until })
    const shared = yield* request("/api/experimental/push/session/ses_push", {
      method: "PUT",
      body: JSON.stringify({ level: "none" }),
    })
    expect(shared.body.data).toEqual({ level: "none" })
    const all = yield* request("/api/experimental/push/settings", {
      method: "PUT",
      body: JSON.stringify({ paused: true, until }),
    })
    expect(all.body.data).toEqual({ paused: true, until })

    const listed = (yield* request("/api/experimental/push")).body.data
    expect(listed.settings).toEqual({ paused: true, until })
    expect(listed.sessions).toEqual({ ses_push: { level: "none" } })
    expect(listed.devices[0].paused).toBe(true)
    expect(listed.devices[0].settings).toEqual({ default: "attention" })
    expect(listed.devices[0].sessions).toEqual({ ses_push: { level: "attention", until } })

    const badLevel = yield* request("/api/experimental/push/session/ses_push", {
      method: "PUT",
      body: JSON.stringify({ level: "loud" }),
    })
    expect(badLevel.status).toBe(400)
    const pastUntil = yield* request("/api/experimental/push/session/ses_push", {
      method: "PUT",
      body: JSON.stringify({ level: "none", until: 1_000 }),
    })
    expect(pastUntil.status).toBe(400)

    expect((yield* request(`${device}/session/ses_push`, { method: "DELETE" })).status).toBe(204)
    expect((yield* request("/api/experimental/push/session/ses_push", { method: "DELETE" })).status).toBe(204)
    const cleared = (yield* request("/api/experimental/push")).body.data
    expect(cleared.sessions).toEqual({})
    expect(cleared.devices[0].sessions).toEqual({})
  }),
)
