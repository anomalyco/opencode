import { expect } from "bun:test"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { Effect, Fiber } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ai, LLMClient } from "../../src/effect.js"
import { Venice } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

// An independent model of Venice's enclave: ECIES over secp256k1 with HKDF-SHA256 ("ecdsa_encryption") and AES-256-GCM.
const key = (secret: Uint8Array, publicKey: Uint8Array) =>
  crypto.subtle
    .importKey("raw", secp256k1.getSharedSecret(secret, publicKey).slice(1), "HKDF", false, ["deriveKey"])
    .then((material) =>
      crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode("ecdsa_encryption") },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ),
    )

const seal = async (text: string, recipient: Uint8Array) => {
  const ephemeral = secp256k1.utils.randomSecretKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key(ephemeral, recipient),
      new TextEncoder().encode(text),
    ),
  )
  return [...secp256k1.getPublicKey(ephemeral, false), ...iv, ...body]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

const open = async (hex: string, secret: Uint8Array) => {
  const bytes = Uint8Array.fromHex(hex)
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(65, 77) },
    await key(secret, bytes.subarray(0, 65)),
    bytes.subarray(77),
  )
  return new TextDecoder().decode(plain)
}

const enclave = (attestation: (nonce: string, publicKey: string) => Record<string, unknown>) => {
  const secret = secp256k1.utils.randomSecretKey()
  // Venice may return the key without its 04 prefix.
  const publicKey = secp256k1.getPublicKey(secret, false).toHex().slice(2)
  const calls: Array<Call> = []
  const layer = dynamicResponse((input) =>
    Effect.gen(function* () {
      const { call } = yield* observe(calls, input)
      const url = new URL(call.url)
      if (url.pathname === "/api/v1/tee/attestation")
        return json(input, attestation(url.searchParams.get("nonce") ?? "", publicKey))
      const client = Uint8Array.fromHex(call.headers.get("x-venice-tee-client-pub-key") ?? "")
      return input.respond(
        sseEvents(
          { choices: [{ delta: { reasoning_content: yield* Effect.promise(() => seal("thinking", client)) } }] },
          { choices: [{ delta: { content: yield* Effect.promise(() => seal("Hello ", client)) } }] },
          {
            choices: [
              { delta: { content: yield* Effect.promise(() => seal("there", client)) }, finish_reason: "stop" },
            ],
          },
        ) + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    }),
  )
  return { secret, publicKey, calls, layer }
}

const model = Venice.configure({ apiKey: "fixture" }).chat("e2ee-qwen3-6-35b-a3b")

it.effect("Venice E2EE models attest, encrypt user and system messages, and decrypt the stream", () =>
  Effect.gen(function* () {
    const server = enclave((nonce, signing_key) => ({ verified: true, nonce, signing_key }))
    const response = yield* LLMClient.generate(ai.request({ model, system: "Be brief.", prompt: "Hi" })).pipe(
      Effect.provide(server.layer),
    )
    expect(response.text).toBe("Hello there")
    expect(response.reasoning).toBe("thinking")

    const [attest, chat] = server.calls
    expect(new URL(attest.url).searchParams.get("model")).toBe("e2ee-qwen3-6-35b-a3b")
    expect(new URL(attest.url).searchParams.get("nonce")).toMatch(/^[0-9a-f]{64}$/)
    expect(attest.headers.get("authorization")).toBe("Bearer fixture")
    expect(chat.headers.get("x-venice-tee-model-pub-key")).toBe(`04${server.publicKey}`)
    expect(chat.headers.get("x-venice-tee-signing-algo")).toBe("ecdsa")
    const messages: Array<{ role: string; content: string }> = JSON.parse(chat.body).messages
    expect(chat.body).not.toContain("Be brief.")
    expect(chat.body).not.toContain("Hi")
    expect(
      yield* Effect.promise(() =>
        Promise.all(messages.map(async (message) => [message.role, await open(message.content, server.secret)])),
      ),
    ).toEqual([
      ["system", "Be brief."],
      ["user", "Hi"],
    ])
  }),
)

it.effect("Venice E2EE refuses to send when attestation fails", () =>
  Effect.gen(function* () {
    for (const attestation of [
      (nonce: string, signing_key: string) => ({ verified: false, nonce, signing_key }),
      (_nonce: string, signing_key: string) => ({ verified: true, nonce: "0".repeat(64), signing_key }),
      (nonce: string) => ({ verified: true, nonce }),
    ]) {
      const server = enclave(attestation)
      const error = yield* LLMClient.generate(ai.request({ model, prompt: "secret" })).pipe(
        Effect.provide(server.layer),
        Effect.flip,
      )
      expect(error.message).toMatch(/attestation/i)
      expect(server.calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/v1/tee/attestation"])
    }
  }),
)

it.effect("Venice E2EE times out a stalled attestation with the request header timeout", () =>
  Effect.gen(function* () {
    const fiber = yield* LLMClient.generate(ai.request({ model, prompt: "secret", timeout: { headers: 1_000 } })).pipe(
      Effect.provide(dynamicResponse(() => Effect.never)),
      Effect.flip,
      Effect.forkChild({ startImmediately: true }),
    )
    yield* TestClock.adjust("1 second")
    expect((yield* Fiber.join(fiber)).message).toMatch(/Timed out waiting for the Venice TEE attestation/)
  }),
)

it.effect("Venice non-E2EE models keep the plaintext route", () =>
  Effect.sync(() => expect(Venice.configure({ apiKey: "fixture" }).chat("qwen3-6-27b").route.id).toBe("venice-chat")),
)
