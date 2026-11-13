import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto"
import type { Socket } from "node:net"
import { Option, Schema } from "effect"

/**
 * Pairing with a nearby phone. This machine advertises `_opencode._tcp` (`discovery.ts`); a phone that lists it and
 * is tapped connects, and this machine runs a key exchange whose six-digit code both screens show. Only once the user
 * confirms the code on both devices does this machine send a pairing code, encrypted for the phone alone, so neither
 * a fake phone nor a fake computer on the network gets anything it could use. Who opened the connection doesn't
 * matter: this machine always speaks first.
 *
 * Wire: each frame is a 4-byte big-endian length and a UTF-8 JSON body of at most 4 KiB. Binary fields are base64url.
 *
 *   D → P  hello    { type, v: 1, pk, name, id }
 *   P → D  commit   { type, pk, c, name? }   name: the phone's, at most 64 characters, for the prompt;  c = SHA256("opencode-pair-v1/commit" ‖ pk_p ‖ pk_d ‖ n_p)
 *   D → P  nonce    { type, n }
 *   P → D  reveal   { type, n }
 *   both: th = SHA256(the four frames as sent, length prefixes included)
 *         code = uint32_be(SHA256("opencode-pair-v1/sas" ‖ pk_d ‖ pk_p ‖ n_d ‖ n_p)[0..4]) mod 1e6
 *         k_dp, k_pd = HKDF-SHA256(X25519, salt th, info "opencode-pair-v1/d→p" | "opencode-pair-v1/p→d")
 *   P → D  sealed confirm                once the user confirms on the phone
 *   D → P  sealed payload { code, urls, expires_in, name, id }   once both confirmed
 *   P → D  sealed done
 *
 * A sealed frame is `{ type: "sealed", box }`, box = nonce(12) ‖ AES-256-GCM ciphertext ‖ tag(16), with th as the
 * additional data and the nonce a per-direction counter from 0 in its last 8 bytes. Either side may send a sealed
 * `cancel`, or close the connection, to end the exchange.
 */
const LABEL = "opencode-pair-v1"

const MAX_FRAME = 4096

/** Each step before the codes show. */
const STEP_TIMEOUT = 10_000

/** The user has this long to compare the codes and confirm on both devices. */
const CONFIRM_TIMEOUT = 120_000

/** Raw X25519 keys inside the DER wrappers node:crypto reads and writes. */
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex")

const Base64 = Schema.String

const Hello = Schema.Struct({
  type: Schema.Literal("hello"),
  v: Schema.Literal(1),
  pk: Base64,
  name: Schema.String,
  id: Schema.String,
})

const Commit = Schema.Struct({
  type: Schema.Literal("commit"),
  pk: Base64,
  c: Base64,
  name: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
})

const NonceMessage = Schema.Struct({ type: Schema.Literal("nonce"), n: Base64 })

const Reveal = Schema.Struct({ type: Schema.Literal("reveal"), n: Base64 })

const Sealed = Schema.Struct({ type: Schema.Literal("sealed"), box: Base64 })

/** What the desktop sends once both devices confirmed: the QR code's `{ code, urls }` and who sent it. */
export const Payload = Schema.Struct({
  code: Schema.String,
  urls: Schema.Array(Schema.String),
  expires_in: Schema.Number,
})

export type Payload = typeof Payload.Type

const Inner = Schema.Union([
  Schema.Struct({ type: Schema.Literal("confirm") }),
  Schema.Struct({ type: Schema.Literal("cancel") }),
  Schema.Struct({ type: Schema.Literal("done") }),
  Schema.Struct({ type: Schema.Literal("payload"), ...Payload.fields, name: Schema.String, id: Schema.String }),
])

export type Inner = typeof Inner.Type

export const messages = { Hello, Commit, Nonce: NonceMessage, Reveal, Sealed, Inner }

/** A message sent in the clear: the exchange's first four, and the envelope of every one after. */
export type Frame =
  | typeof Hello.Type
  | typeof Commit.Type
  | typeof NonceMessage.Type
  | typeof Reveal.Type
  | typeof Sealed.Type

/** The keys, once the exchange derived them; a cancel is sealed only then. */
type Established = { current?: Session }

/** What `frames` has read but not yet returned, why it stopped, and the read waiting for more. */
type ReadState = { buffer: Buffer; error?: Error; wake?: () => void }

/** Keys for one direction each, and the transcript hash both bind to. */
export type Session = { send: Buffer; receive: Buffer; transcript: Buffer; sent: { n: bigint }; received: { n: bigint } }

/**
 * Runs the desktop's side over a connected socket. `code` resolves once the six-digit code is ready to show, with
 * the name the phone gave;
 * `approve` records the user's confirmation; `payload` is asked for only after both devices confirmed. `done`
 * resolves once the phone reports it redeemed the code, and rejects when the exchange ends any other way.
 */
export function initiate(socket: Socket, input: { name: string; id: string; payload: () => Promise<Payload> }) {
  const controller = new AbortController()
  const code = Promise.withResolvers<{ code: string; device?: string }>()
  const approval = Promise.withResolvers<void>()
  const session: Established = {}
  // Neither promise may reject unobserved: the exchange can end before anyone awaits them.
  code.promise.catch(() => undefined)
  approval.promise.catch(() => undefined)
  controller.signal.addEventListener("abort", () => {
    approval.reject(controller.signal.reason)
    code.reject(controller.signal.reason)

    if (session.current && !socket.destroyed) socket.write(seal(session.current, { type: "cancel" }))
    socket.destroy()
  })

  const run = async () => {
    const next = frames(socket)
    const keys = keyPair()
    const hello = frame({ type: "hello", v: 1, pk: keys.publicKey.toString("base64url"), name: input.name, id: input.id })
    socket.write(hello)

    const commitFrame = await next(STEP_TIMEOUT)
    const commit = decode(Commit, commitFrame)
    const peer = bytes(commit.pk, 32)
    const nD = randomBytes(16)
    const nonceFrame = frame({ type: "nonce", n: nD.toString("base64url") })
    socket.write(nonceFrame)

    const revealFrame = await next(STEP_TIMEOUT)
    const nP = bytes(decode(Reveal, revealFrame).n, 16)

    if (!timingSafeEqual(commitment(peer, keys.publicKey, nP), bytes(commit.c, 32)))
      throw new Error("the phone's commitment does not match")

    const transcript = sha256(hello, commitFrame, nonceFrame, revealFrame)
    const derived = sessionKeys(keys.privateKey, peer, transcript)
    session.current = { send: derived.dp, receive: derived.pd, transcript, sent: { n: 0n }, received: { n: 0n } }
    code.resolve({ code: shortCode(keys.publicKey, peer, nD, nP), device: commit.name?.trim() || undefined })

    const timer = setTimeout(() => controller.abort(new Error("timed out waiting for confirmation")), CONFIRM_TIMEOUT)
    await Promise.all([approval.promise, receive(session.current, next, "confirm", CONFIRM_TIMEOUT)]).finally(() =>
      clearTimeout(timer),
    )

    const payload = await input.payload()
    socket.write(seal(session.current, { type: "payload", ...payload, name: input.name, id: input.id }))
    await receive(session.current, next, "done", CONFIRM_TIMEOUT)
    socket.end()
  }

  const done = run().catch((error: Error) => {
    if (!controller.signal.aborted) controller.abort(error)
    throw controller.signal.reason
  })

  return {
    code: code.promise,
    done,
    approve: () => approval.resolve(),
    cancel: () => controller.abort(new Error("cancelled")),
  }
}

/** Waits for one sealed message of `type`; a sealed `cancel` or anything else ends the exchange. */
export async function receive(
  session: Session,
  next: (timeout: number) => Promise<Buffer>,
  type: Inner["type"],
  timeout: number,
) {
  const message = open(session, decode(Sealed, await next(timeout)))

  if (message.type === "cancel") throw new Error("cancelled on the other device")

  if (message.type !== type) throw new Error(`expected ${type}, got ${message.type}`)

  return message
}

/** A fresh X25519 key pair, with the raw 32-byte public key. */
export function keyPair() {
  const pair = generateKeyPairSync("x25519")

  return { privateKey: pair.privateKey, publicKey: rawPublicKey(pair.publicKey) }
}

export function rawPublicKey(key: KeyObject) {
  return key.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length)
}

export function commitment(phoneKey: Buffer, desktopKey: Buffer, phoneNonce: Buffer) {
  return sha256(Buffer.from(`${LABEL}/commit`), phoneKey, desktopKey, phoneNonce)
}

/** The six digits both screens show. */
export function shortCode(desktopKey: Buffer, phoneKey: Buffer, desktopNonce: Buffer, phoneNonce: Buffer) {
  const digest = sha256(Buffer.from(`${LABEL}/sas`), desktopKey, phoneKey, desktopNonce, phoneNonce)

  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0")
}

/** The keys for each direction, from the shared secret and the transcript hash. */
export function sessionKeys(privateKey: KeyObject, peer: Buffer, transcript: Buffer) {
  const secret = diffieHellman({
    privateKey,
    publicKey: createPublicKey({ key: Buffer.concat([SPKI_PREFIX, peer]), format: "der", type: "spki" }),
  })

  const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, transcript, `${LABEL}/${info}`, 32))

  return { dp: derive("d→p"), pd: derive("p→d") }
}

/** A sealed frame for `message`, the next in this direction. */
export function seal(session: Session, message: Inner) {
  const nonce = counterNonce(session.sent.n)
  session.sent.n += 1n
  const cipher = createCipheriv("aes-256-gcm", session.send, nonce)
  cipher.setAAD(session.transcript)
  const body = Buffer.concat([cipher.update(JSON.stringify(message), "utf8"), cipher.final()])

  return frame({ type: "sealed", box: Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url") })
}

/** Opens the next sealed frame from the other side; a replayed, reordered or altered one ends the exchange. */
export function open(session: Session, sealed: typeof Sealed.Type) {
  const box = Buffer.from(sealed.box, "base64url")
  const nonce = box.subarray(0, 12)

  if (box.length < 28 || !nonce.equals(counterNonce(session.received.n))) throw new Error("unexpected sealed frame")
  session.received.n += 1n
  const decipher = createDecipheriv("aes-256-gcm", session.receive, nonce)
  decipher.setAAD(session.transcript)
  decipher.setAuthTag(box.subarray(box.length - 16))
  const plain = Buffer.concat([decipher.update(box.subarray(12, box.length - 16)), decipher.final()])

  return decodeJson(Inner, plain.toString("utf8"))
}

export function frame(message: Frame) {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  const head = Buffer.alloc(4)
  head.writeUInt32BE(body.length)

  return Buffer.concat([head, body])
}

/**
 * Reads whole frames from a socket, as sent, length prefix included. Each call waits for the next one, at most
 * `timeout` milliseconds; a closed socket, an oversized frame or the timeout rejects.
 */
export function frames(socket: Socket) {
  const queue: Buffer[] = []
  const state: ReadState = { buffer: Buffer.alloc(0) }

  const wake = () => {
    const resume = state.wake
    state.wake = undefined
    resume?.()
  }

  socket.on("data", (chunk: Buffer) => {
    state.buffer = Buffer.concat([state.buffer, chunk])
    split()
    wake()
  })
  socket.on("close", () => {
    state.error ??= new Error("the connection closed")
    wake()
  })
  socket.on("error", (error: Error) => {
    state.error ??= error
    wake()
  })

  const split = () => {
    if (state.buffer.length < 4) return
    const length = state.buffer.readUInt32BE(0)

    if (length > MAX_FRAME) {
      state.error = new Error("frame too large")
      socket.destroy()

      return
    }

    if (state.buffer.length < 4 + length) return
    queue.push(state.buffer.subarray(0, 4 + length))
    state.buffer = state.buffer.subarray(4 + length)
    split()
  }

  const next = async (deadline: number): Promise<Buffer> => {
    const raw = queue.shift()

    if (raw) return raw

    if (state.error) throw state.error

    if (Date.now() >= deadline) throw new Error("timed out")
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, deadline - Date.now())
      state.wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })

    return next(deadline)
  }

  return (timeout: number) => next(Date.now() + timeout)
}

export function decode<S extends Schema.Codec<unknown, unknown>>(schema: S, raw: Buffer): S["Type"] {
  return decodeJson(schema, raw.subarray(4).toString("utf8"))
}

function decodeJson<S extends Schema.Codec<unknown, unknown>>(schema: S, text: string): S["Type"] {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(schema))(text)

  if (Option.isNone(decoded)) throw new Error("malformed pairing message")

  return decoded.value
}

export function bytes(value: string, length: number) {
  const decoded = Buffer.from(value, "base64url")

  if (decoded.length !== length) throw new Error("malformed pairing message")

  return decoded
}

export function sha256(...parts: Buffer[]) {
  return parts.reduce((hash, part) => hash.update(part), createHash("sha256")).digest()
}

function counterNonce(counter: bigint) {
  const nonce = Buffer.alloc(12)
  nonce.writeBigUInt64BE(counter, 4)

  return nonce
}
