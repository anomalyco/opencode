import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { Noise } from "@opencode/core/machine/noise"
import { Result } from "effect"
import { Miniflare } from "miniflare"
import vectors from "./fixture/noise-xx-vectors.json"

// noise.ts inside real workerd (the version wrangler 4.110.0 runs), whose node:crypto cannot use a raw X25519 peer key
// and fails AES-GCM with an empty ad or empty text. A regression here passes every Bun test and fails only on Workers.

const text = (value: string) => new Uint8Array(Buffer.from(value))
const ok = <A>(result: Result.Result<A, Noise.Failure>) => Result.getOrThrow(result)
const all = [...vectors["cacophony.txt"], ...vectors["snow.txt"]]

const state: { miniflare?: Miniflare; url?: URL } = {}

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "fixture/noise-workerd.ts")],
    conditions: ["workerd"],
    target: "node",
    format: "esm",
  })
  if (!build.success) throw new AggregateError(build.logs, "Could not bundle the workerd fixture")
  state.miniflare = new Miniflare({
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    script: await build.outputs[0].text(),
    durableObjects: { LINK: "NoiseLink" },
  })
  state.url = await state.miniflare.ready
})

afterAll(() => state.miniflare?.dispose())

describe("Noise in workerd", () => {
  test("reproduces every published vector byte for byte", async () => {
    const response = await fetch(new URL("/vectors", state.url), { method: "POST", body: JSON.stringify(all) })
    expect(response.status).toBe(200)
    const results = (await response.json()) as Array<{ ciphertexts: string[]; hash: string }>
    results.forEach((result, index) => {
      expect(result.ciphertexts).toEqual(all[index].messages.map((message) => message.ciphertext))
      if ("handshake_hash" in all[index]) expect(result.hash).toBe(all[index].handshake_hash)
    })
  })

  test("completes a handshake with a Durable Object over a WebSocket, then carries empty messages across a rekey", async () => {
    const socket = new WebSocket(new URL("/link", state.url).href.replace(/^http/, "ws"))
    socket.binaryType = "arraybuffer"
    const inbox: Uint8Array[] = []
    const waiting: Array<PromiseWithResolvers<Uint8Array>> = []
    const closed = { value: false }
    socket.addEventListener("message", (event) => {
      const message = new Uint8Array(event.data as ArrayBuffer)
      const next = waiting.shift()
      if (next) next.resolve(message)
      else inbox.push(message)
    })
    // The Durable Object drops the socket when noise.ts throws in workerd: fail now rather than at the test timeout.
    socket.addEventListener("close", () => {
      closed.value = true
      for (const next of waiting.splice(0)) next.reject(new Error("The Durable Object closed the WebSocket"))
    })
    const receive = () => {
      const message = inbox.shift()
      if (message) return Promise.resolve(message)
      if (closed.value) return Promise.reject(new Error("The Durable Object closed the WebSocket"))
      const next = Promise.withResolvers<Uint8Array>()
      waiting.push(next)
      return next.promise
    }
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve)
      socket.addEventListener("error", reject)
    })

    const initiator = ok(
      Noise.handshake({ initiator: true, prologue: text("opencode-workerd"), static: Noise.generateKeyPair() }),
    )
    socket.send(ok(initiator.write(new Uint8Array(0))))
    expect(ok(initiator.read(await receive()))).toEqual(new Uint8Array(0))
    socket.send(ok(initiator.write(new Uint8Array(0))))
    const transport = ok(initiator.split())
    expect(initiator.hash).toBeDefined()
    expect(ok(transport.receive.decrypt(await receive()))).toEqual(initiator.hash!)

    for (const plaintext of [new Uint8Array(0), text("hello"), text("rekey"), new Uint8Array(0), text("after rekey")]) {
      socket.send(ok(transport.send.encrypt(plaintext)))
      expect(ok(transport.receive.decrypt(await receive()))).toEqual(plaintext)
      if (Buffer.from(plaintext).toString() !== "rekey") continue
      transport.send.rekey()
      transport.receive.rekey()
    }
    socket.close()
  })
})
