import { secp256k1 } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js"
import { Duration, Effect, Schema, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/http"
import { OpenAIChat } from "../../protocols/openai-chat.js"
import * as ProviderShared from "../../protocols/shared.js"
import type { VeniceChat } from "../../protocols/venice-chat.js"
import { HttpTransport, type HttpMiddleware, type Transport } from "../../route/transport/index.js"
import {
  AIError,
  DEFAULT_HTTP_TIMEOUT_MS,
  InvalidProviderOutputError,
  timeoutConfig,
  TransportError,
  type LLMRequest,
  type RequestEncoding,
} from "../../schema/index.js"

/**
 * Venice end-to-end encryption (https://docs.venice.ai/guides/features/tee-e2ee-models).
 *
 * Each request fetches a fresh attestation for the model's enclave key, encrypts every user and system
 * message to it (secp256k1 ECDH, HKDF-SHA256, AES-256-GCM), and decrypts the streamed deltas with a
 * per-request session key. Assistant and tool messages and tool definitions are sent as Venice
 * documents them: in plaintext.
 */

type Message = VeniceChat.Body["messages"][number]

export interface Prepared {
  readonly url: string
  readonly jsonBody: Record<string, unknown>
  readonly headers: Headers.Headers
  readonly messages: ReadonlyArray<Message>
  readonly model: string
  readonly encoding?: RequestEncoding
  readonly middleware?: HttpMiddleware
}

const http = HttpTransport.httpJson<unknown, string>({ framing: OpenAIChat.framing })

export const transport: Transport<VeniceChat.Body, Prepared, string> = {
  id: "venice-e2ee",
  prepare: (input) =>
    Effect.gen(function* () {
      const parts = yield* HttpTransport.jsonRequestParts(input)
      return {
        url: parts.url,
        jsonBody: { ...parts.jsonBody },
        headers: parts.headers,
        messages: yield* Effect.forEach(input.body.messages, textOnly),
        model: input.body.model,
        encoding: input.request.http?.encoding,
        middleware: input.middleware,
      }
    }),
  execute: (prepared, request, runtime) =>
    Effect.gen(function* () {
      const session = secp256k1.utils.randomSecretKey()
      const modelKey = yield* attest(prepared, request, runtime)
      const messages = yield* Effect.forEach(prepared.messages, (message) =>
        (message.role === "user" || message.role === "system") && typeof message.content === "string"
          ? encrypt(message.content, hexToBytes(modelKey)).pipe(Effect.map((content) => ({ ...message, content })))
          : Effect.succeed(message),
      )
      const execution = yield* http.execute(
        {
          request: ProviderShared.jsonPost({
            url: prepared.url,
            body: ProviderShared.encodeJson({ ...prepared.jsonBody, messages }),
            headers: Headers.setAll(prepared.headers, {
              "x-venice-tee-client-pub-key": bytesToHex(secp256k1.getPublicKey(session, false)),
              "x-venice-tee-model-pub-key": modelKey,
              "x-venice-tee-signing-algo": "ecdsa",
            }),
            encoding: prepared.encoding,
          }),
          framing: OpenAIChat.framing,
          middleware: prepared.middleware,
        },
        request,
        runtime,
      )
      return { ...execution, frames: execution.frames.pipe(Stream.mapEffect((frame) => decryptFrame(frame, session))) }
    }),
}

// Venice requires every user and system message to be a single encrypted string, so it cannot carry media.
const textOnly = (message: Message) => {
  if ((message.role !== "user" && message.role !== "system") || typeof message.content === "string")
    return Effect.succeed(message)
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
  if (text.length !== message.content.length)
    return Effect.fail(ProviderShared.invalidRequest("Venice E2EE models accept text-only user and system messages"))
  return Effect.succeed({ ...message, content: text.join("\n") })
}

const Attestation = Schema.Struct({
  verified: Schema.Boolean,
  nonce: Schema.String,
  signing_key: Schema.optional(Schema.String),
  signing_public_key: Schema.optional(Schema.String),
})

// ponytail: trusts Venice's server-side `verified` verdict plus nonce freshness, the baseline the guide
// describes. Client-side TDX quote, debug-flag, and REPORTDATA key-binding checks would go here.
const attest = Effect.fn("VeniceE2EE.attest")(function* (
  prepared: Prepared,
  request: LLMRequest,
  runtime: Parameters<typeof http.execute>[2],
) {
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
  const url = new URL(prepared.url)
  url.pathname = url.pathname.replace(/\/chat\/completions$/, "/tee/attestation")
  url.searchParams.set("model", prepared.model)
  url.searchParams.set("nonce", nonce)
  // Bound by the chat call's header timeout so a stalled attestation cannot hang the request.
  const limits = timeoutConfig(request.timeout)
  const attestation = yield* runtime.http
    .execute(
      HttpClientRequest.get(url.toString()).pipe(HttpClientRequest.setHeaders(prepared.headers)),
      prepared.middleware,
    )
    .pipe(
      Effect.flatMap((response) =>
        response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Attestation)),
          Effect.mapError((cause) => attestationError("Venice returned an unreadable TEE attestation", cause)),
        ),
      ),
      Effect.timeoutOrElse({
        duration: Duration.min(
          limits.headers === false ? Duration.infinity : Duration.millis(limits.headers ?? DEFAULT_HTTP_TIMEOUT_MS),
          limits.total ? Duration.millis(limits.total) : Duration.infinity,
        ),
        orElse: () =>
          Effect.fail(
            new AIError({
              reason: new TransportError({
                message: "Timed out waiting for the Venice TEE attestation",
                transport: "http",
                operation: "request",
                code: "Timeout",
                url: url.toString(),
              }),
            }),
          ),
      }),
    )
  if (!attestation.verified) return yield* attestationError("Venice TEE attestation verification failed")
  if (attestation.nonce !== nonce) return yield* attestationError("Venice TEE attestation nonce mismatch")
  const key = attestation.signing_key ?? attestation.signing_public_key
  if (!key || !/^(04)?[0-9a-f]{128}$/i.test(key))
    return yield* attestationError("Venice TEE attestation has no usable model public key")
  return key.length === 128 ? `04${key}` : key
})

const attestationError = (message: string, cause?: unknown) =>
  new AIError({ reason: new InvalidProviderOutputError({ message, route: "venice-e2ee", cause }) })

const info = new TextEncoder().encode("ecdsa_encryption")

const aesKey = async (secret: Uint8Array, publicKey: Uint8Array) =>
  crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info },
    // The compressed shared point drops its prefix byte to leave the 32-byte x-coordinate.
    await crypto.subtle.importKey("raw", secp256k1.getSharedSecret(secret, publicKey).slice(1), "HKDF", false, [
      "deriveKey",
    ]),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )

// Wire format: ephemeral uncompressed public key (65) || nonce (12) || ciphertext with GCM tag, hex encoded.
const encrypt = (text: string, modelKey: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const ephemeral = secp256k1.utils.randomSecretKey()
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const sealed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await aesKey(ephemeral, modelKey),
        new TextEncoder().encode(text),
      )
      const publicKey = secp256k1.getPublicKey(ephemeral, false)
      const out = new Uint8Array(publicKey.length + iv.length + sealed.byteLength)
      out.set(publicKey)
      out.set(iv, publicKey.length)
      out.set(new Uint8Array(sealed), publicKey.length + iv.length)
      return bytesToHex(out)
    },
    catch: (cause) => ProviderShared.invalidRequest("Venice E2EE encryption failed", cause),
  })

const decrypt = (hex: string, session: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      // Copy onto an ArrayBuffer: the BufferSource type rejects views over a possibly shared buffer.
      const bytes = new Uint8Array(hexToBytes(hex))
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.subarray(65, 77) },
        await aesKey(session, bytes.subarray(0, 65)),
        bytes.subarray(77),
      )
      return new TextDecoder().decode(plain)
    },
    catch: (cause) => attestationError("Failed to decrypt a Venice E2EE response chunk", cause),
  })

const Chunk = Schema.fromJsonString(
  Schema.StructWithRest(
    Schema.Struct({
      choices: Schema.Array(
        Schema.StructWithRest(
          Schema.Struct({
            delta: Schema.StructWithRest(
              Schema.Struct({
                content: Schema.optional(Schema.NullOr(Schema.String)),
                reasoning_content: Schema.optional(Schema.NullOr(Schema.String)),
              }),
              [Schema.Record(Schema.String, Schema.Unknown)],
            ),
          }),
          [Schema.Record(Schema.String, Schema.Unknown)],
        ),
      ),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
)
const decodeChunk = Schema.decodeUnknownOption(Chunk)

// Venice marks no chunk as encrypted; its guide treats hex of at least one empty sealed message
// (65 + 12 + 16 bytes) as ciphertext. Frames without deltas (usage, errors, `[DONE]`) pass through.
const sealed = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length >= 186 && /^(?:[0-9a-f]{2})+$/i.test(value)

const decryptFrame = (frame: string, session: Uint8Array) => {
  const chunk = decodeChunk(frame)
  if (chunk._tag === "None") return Effect.succeed(frame)
  return Effect.forEach(chunk.value.choices, (choice) =>
    Effect.all({
      content: sealed(choice.delta.content)
        ? decrypt(choice.delta.content, session)
        : Effect.succeed(choice.delta.content),
      reasoning_content: sealed(choice.delta.reasoning_content)
        ? decrypt(choice.delta.reasoning_content, session)
        : Effect.succeed(choice.delta.reasoning_content),
    }).pipe(Effect.map((delta) => ({ ...choice, delta: { ...choice.delta, ...delta } }))),
  ).pipe(Effect.map((choices) => ProviderShared.encodeJson({ ...chunk.value, choices })))
}

export * as VeniceE2EE from "./e2ee.js"
