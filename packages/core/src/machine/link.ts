export * as Link from "./link.js"

import { Cause, Effect, Schema } from "effect"
import type { Environment } from "../environment/index.js"
import { Frames } from "./frames.js"
import { Identity } from "./identity.js"
import type { Machine } from "./index.js"
import { Machines } from "./machines.js"
import { Noise } from "./noise.js"
import { FromWorker, Hello, ToWorker } from "./wire.js"

// The handshake that opens a link between the home (the OpenCode server) and a machine that connects to it: a worker
// today, any client later. The side that opens the connection calls `dial`; the home calls `accept`. Both end holding
// the peer's proven identity and two ciphers for everything that follows, over a carrier that may pass through relays
// neither side trusts.
//
// It is Noise XX with the dialling side as initiator. Each side proves its long-term Ed25519 identity by signing a
// Noise static key made for this one connection together with the handshake hash so far. The home proves itself
// first, in message 2; the dialling side checks it against the home key it was given before it writes message 3, the
// one that carries its own identity and, on first contact, its join secret. Every field is fixed-size raw bytes, so the
// Rust worker reads and writes these without lengths or JSON:
//
//   1  worker -> home   e                                                                        32 bytes
//   2  home -> worker   e, s, { home key || sign(home key, HOME || home static || h1) }         192 bytes
//   3  worker -> home   s, { worker key || sign(worker key, MACHINE || worker static || h2)
//                              || has secret || secret }                                         193 bytes
//   then the home's first transport message, the machine's name in UTF-8, and frames.ts from there on
//
// h1 is the hash once message 1 is read and h2 once message 2 is read; both sides hold the same h at each step.
//
// Bytes are copied on the way in and on the way out, as in noise.ts.

const text = (value: string) => new TextEncoder().encode(value)
const PROTOCOL = Hello.fields.protocol.literal
// Matches Rust opencode-worker's `is_valid_machine_name`: `Machines.Name` (^[a-z][a-z0-9-]{1,62}$ and != "local").
const isWelcomeName = Schema.is(Machines.Name)
const isValidWelcomeName = (name: string): boolean => isWelcomeName(name)
const toWelcomeName = (machine: string) => {
  if (isValidWelcomeName(machine)) return machine
  const slug = machine.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  const candidate = (/^[a-z]/.test(slug) ? slug : `w-${slug}`).slice(0, 63)
  return isValidWelcomeName(candidate) ? candidate : "workspace"
}
const PROLOGUE = text("opencode-link-v1")
const HOME = text("opencode-link-v1/home:")
const MACHINE = text("opencode-link-v1/machine:")
const KEY = 32
const SIGNATURE = 64
const TAG = 16
// A reconnect sends zeros where an enrolment sends its secret, so a relay cannot tell the two apart by length.
const NO_SECRET = new Uint8Array(KEY)
const FIRST = KEY
const SECOND = KEY + KEY + TAG + (KEY + SIGNATURE) + TAG
const THIRD = KEY + TAG + (KEY + SIGNATURE + 1 + KEY) + TAG
const DEADLINE = "10 seconds"
/** Each direction rekeys after this many transport messages: 2^20 frames of at most 64 KiB is 64 GiB per AES-GCM key. */
const REKEY_INTERVAL = 2 ** 20

/** The carrier ended: the connection under it closed. */
export class Closed extends Schema.TaggedError<Closed>()("Link.Closed", {}) {}

/**
 * One failure for every refused handshake, on either side, saying nothing about which step refused it. The caller
 * closes the carrier; nothing more is sent on it.
 */
export class Refused extends Schema.TaggedError<Refused>()("Link.Refused", {}) {
  override get message() {
    return "The link was refused."
  }
}

/**
 * Carries one binary message at a time, in order: a WebSocket, through whatever relays it. Both `send` and `receive`
 * must be interruptible, or `accept`'s deadline cannot cut short a peer that stops reading or writing.
 */
export interface Carrier {
  /** Read on demand, so a path change is reflected by the next machine list. */
  readonly describe?: Machine.Connection["describe"]
  readonly send: (message: Uint8Array) => Effect.Effect<void>
  /** The next message, failing once the carrier has ended. */
  readonly receive: Effect.Effect<Uint8Array, Closed>
}

/**
 * Only for tests: the pinned transcript fixes the key pairs, and the rekey tests shorten the interval. Production
 * callers never set these and get fresh key pairs for every connection and a rekey every 2^20 messages.
 */
export interface Fixed {
  readonly static?: Noise.KeyPair
  readonly ephemeral?: Noise.KeyPair
  readonly rekeyInterval?: number
}

export interface DialOptions extends Fixed {
  /** The home's Ed25519 public key: the join string's on first contact, the caller's own record of it afterwards. */
  readonly home: Uint8Array
  /** The dialling side's long-term Ed25519 key, the one the home pairs with a machine. */
  readonly identity: Identity.Key
  /**
   * The join secret, on first contact only. Forget it only once `dial` succeeds: until then the caller cannot know
   * whether the home received it, and a home that already paired this key lets it in again whatever secret it brings.
   */
  readonly secret?: Uint8Array
}

type Authenticate = (peer: {
  readonly key: Uint8Array
  readonly hasSecret: boolean
  readonly secret: Uint8Array
}) => Effect.Effect<Environment.ID, Refused>

// A key the home already knows is a reconnect whatever else the message carries; an unknown key needs a valid secret.
const authenticateMachine =
  (machines: Machines.Interface): Authenticate =>
  (peer) =>
    machines.identify(peer.key).pipe(
      Effect.catch(() => {
        if (peer.hasSecret)
          return machines.join({ secret: peer.secret, key: peer.key }).pipe(Effect.mapError(() => new Refused()))
        return Effect.fail(new Refused())
      }),
    )

/**
 * Logs why this side refused a handshake, then fails with the bare `Refused`: the peer still learns nothing, but a
 * defect such as a runtime's crypto failing shows in this side's logs instead of passing for a refused peer.
 */
const refuse = (step: string) => (cause: Cause.Cause<unknown>) =>
  (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning(`${step} refused the link`, { cause })).pipe(
    Effect.andThen(Effect.fail(new Refused())),
  )

/**
 * The home's side, called with the carrier of a connection it received.
 *
 * Proves the home's key to the peer, then requires the peer's proof of its own key. A key the home has paired is a
 * reconnect; a key it has not is paired only with a valid join secret for one of its machines. On success the home
 * has already sent the welcome, the machine's name, and returns that machine's id with `send` and `receive`, the
 * ciphers for every later message on this carrier, in order.
 *
 * Anything else, including ten seconds passing, is `Refused`, and nothing that says why reaches the peer: the caller
 * closes the carrier. Interrupting `accept` interrupts it; that is never turned into `Refused`.
 */
export const accept = Effect.fn("Link.accept")(
  function* (carrier: Carrier, fixed: Fixed = {}) {
    const machines = yield* Machines.Service
    return yield* handshake(carrier, authenticateMachine(machines), fixed)
  },
  Effect.timeout(DEADLINE),
  Effect.catchCause(refuse("Link.accept")),
)

export const decodeHello = Effect.fnUntraced(function* (machine: Environment.ID, bytes: Uint8Array) {
  const message = yield* helloMessage.decode(bytes)
  const version = yield* Schema.decodeUnknownEffect(helloProtocol)(message)
  if (version.protocol !== PROTOCOL) {
    yield* Effect.logWarning(
      `Machine ${machine} uses protocol ${version.protocol}; this home requires protocol ${PROTOCOL}. The worker and the home must be the same version.`,
    )
    return yield* new Refused()
  }
  return yield* Schema.decodeUnknownEffect(Hello)(message)
})

const serveWith = Effect.fnUntraced(function* (carrier: Carrier, authenticate: Authenticate, fixed: Fixed) {
  const link = yield* Effect.gen(function* () {
    const accepted = yield* handshake(carrier, authenticate, fixed)
    const hello = yield* decodeHello(accepted.machine, yield* Frames.read(carrier, accepted.receive))
    return { ...accepted, hello }
  }).pipe(Effect.timeout(DEADLINE), Effect.catchCause(refuse("Link.serve")))
  const frames = yield* Frames.open(carrier, link, workerCodec)
  return {
    machine: link.machine,
    connection: { hello: link.hello, send: frames.send, messages: frames.messages, describe: carrier.describe },
  }
})

/**
 * The home's side of a connection to a worker, called with the carrier it received.
 *
 * Runs `accept`'s handshake, then requires the worker's first message to be a valid hello, all inside the same ten
 * seconds. Returns the machine the handshake proved, which the hello cannot change, and a `Connection` for the driver:
 * the caller serves it with `Machines.connect(machine, connection)` in the scope the link's fibers live in, and closes
 * that scope and the carrier once it returns. Anything else before that is `Refused`, as with `accept`.
 */
export const serve = Effect.fn("Link.serve")(function* (carrier: Carrier, fixed: Fixed = {}) {
  const machines = yield* Machines.Service
  return yield* serveWith(carrier, authenticateMachine(machines), fixed)
})

/**
 * Serves a direct (pull-mode or relay-bridged) link to a worker whose Ed25519 public key `peerKey` is already
 * pinned by the caller (e.g. a cloud VM or sandbox binding), without consulting `Machines.Service`.
 */
export const serveDirect = Effect.fn("Link.serveDirect")(function* (
  carrier: Carrier,
  options: { readonly machine: Environment.ID; readonly peerKey: Uint8Array },
  fixed: Fixed = {},
) {
  const expected = new Uint8Array(options.peerKey)
  if (expected.length !== KEY) return yield* new Refused()
  return yield* serveWith(
    carrier,
    (peer) =>
      !peer.hasSecret && same(peer.key, expected) ? Effect.succeed(options.machine) : Effect.fail(new Refused()),
    fixed,
  )
})

const handshake = Effect.fnUntraced(function* (carrier: Carrier, authenticate: Authenticate, fixed: Fixed) {
  const identity = yield* Identity.Service
  const local = fixed.static ?? Noise.generateKeyPair()
  const noise = yield* Effect.fromResult(
    Noise.handshake({ initiator: false, prologue: PROLOGUE, static: local, ephemeral: fixed.ephemeral }),
  )
  yield* Effect.fromResult(noise.read(yield* receive(carrier, FIRST)))
  const signature = yield* identity.sign(concat(HOME, local.publicKey, yield* Effect.fromNullishOr(noise.hash)))
  yield* carrier.send(yield* Effect.fromResult(noise.write(concat(yield* identity.publicKey(), signature))))
  const h2 = yield* Effect.fromNullishOr(noise.hash)
  const payload = yield* Effect.fromResult(noise.read(yield* receive(carrier, THIRD)))
  const key = payload.slice(0, KEY)
  const signed = concat(MACHINE, yield* Effect.fromNullishOr(noise.remoteStatic), h2)
  if (!Identity.verify(key, signed, payload.subarray(KEY, KEY + SIGNATURE))) return yield* new Refused()
  const flag = payload[KEY + SIGNATURE]
  const secret = payload.slice(KEY + SIGNATURE + 1)
  if (flag > 1 || (flag === 0 && !same(secret, NO_SECRET))) return yield* new Refused()
  const machine = yield* authenticate({ key, hasSecret: flag === 1, secret })
  const ciphers = Frames.rekeying(yield* Effect.fromResult(noise.split()), fixed.rekeyInterval ?? REKEY_INTERVAL)
  yield* carrier.send(yield* Effect.fromResult(ciphers.send.encrypt(text(toWelcomeName(machine)))))
  return { machine, send: ciphers.send, receive: ciphers.receive }
})

/**
 * The side that opens the connection, called with the carrier it opened.
 *
 * Requires the home to prove the key in `options.home` first, and only then proves its own key and sends the join
 * secret, so the secret never reaches any other home. On success returns the machine name the home welcomed it as,
 * with `send` and `receive`, the ciphers for every later message on this carrier, in order.
 *
 * Anything else is `Refused`, and the caller closes the carrier. `dial` has no deadline of its own: the caller bounds
 * it, for example with `Effect.timeout`. Interrupting it interrupts it; that is never turned into `Refused`.
 */
export const dial = Effect.fn("Link.dial")(
  function* (carrier: Carrier, options: DialOptions) {
    const home = new Uint8Array(options.home)
    const secret = options.secret === undefined ? NO_SECRET : new Uint8Array(options.secret)
    if (secret.length !== KEY) return yield* new Refused()
    const local = options.static ?? Noise.generateKeyPair()
    const noise = yield* Effect.fromResult(
      Noise.handshake({ initiator: true, prologue: PROLOGUE, static: local, ephemeral: options.ephemeral }),
    )
    yield* carrier.send(yield* Effect.fromResult(noise.write(new Uint8Array(0))))
    const h1 = yield* Effect.fromNullishOr(noise.hash)
    const payload = yield* Effect.fromResult(noise.read(yield* receive(carrier, SECOND)))
    const signed = concat(HOME, yield* Effect.fromNullishOr(noise.remoteStatic), h1)
    if (!same(payload.subarray(0, KEY), home) || !Identity.verify(home, signed, payload.subarray(KEY)))
      return yield* new Refused()
    const signature = options.identity.sign(concat(MACHINE, local.publicKey, yield* Effect.fromNullishOr(noise.hash)))
    const flag = Uint8Array.of(options.secret === undefined ? 0 : 1)
    yield* carrier.send(
      yield* Effect.fromResult(noise.write(concat(options.identity.publicKey, signature, flag, secret))),
    )
    const ciphers = Frames.rekeying(yield* Effect.fromResult(noise.split()), options.rekeyInterval ?? REKEY_INTERVAL)
    const welcome = utf8.decode(yield* Effect.fromResult(ciphers.receive.decrypt(yield* carrier.receive)))
    if (!isValidWelcomeName(welcome)) return yield* new Refused()
    return { machine: welcome, send: ciphers.send, receive: ciphers.receive }
  },
  Effect.catchCause(refuse("Link.dial")),
)

/**
 * The side that opens the connection, called with the carrier it opened: the worker, and the reference for the Rust
 * one.
 *
 * Runs `dial`'s handshake and returns the machine name the home welcomed it as, `send` for messages to the home, and
 * `messages` from it, each a wire.ts message. A worker's first `send` must be its hello, or the home refuses it. The
 * link's fibers live in the caller's scope, and the link ends as `Frames.open` says, ending `messages`: the caller then
 * closes the carrier and that scope. Bounded and refused as `dial` is.
 */
export const connect = Effect.fn("Link.connect")(function* (carrier: Carrier, options: DialOptions) {
  const dialed = yield* dial(carrier, options)
  const frames = yield* Frames.open(carrier, dialed, { decode: toWorker.decode, encode: fromWorker.encode })
  return { machine: dialed.machine, send: frames.send, messages: frames.messages }
})

/** The next message, refused unless it has exactly the length its step's layout gives it, before Noise reads it. */
const receive = (carrier: Carrier, length: number) =>
  Effect.flatMap(carrier.receive, (message) =>
    message.length === length ? Effect.succeed(message) : Effect.fail(new Refused()),
  )

const utf8 = new TextDecoder("utf-8", { fatal: true })

/** A wire.ts message as the UTF-8 JSON a frame carries. */
const json = <T>(schema: Schema.Codec<T, string>): Frames.Codec<T, T> => ({
  decode: (bytes) =>
    Effect.flatMap(
      Effect.try(() => utf8.decode(bytes)),
      Schema.decodeEffect(schema),
    ),
  encode: (message) => Effect.map(Schema.encodeEffect(schema)(message), text),
})
const helloMessage = json(Schema.fromJsonString(Schema.Unknown))
const helloProtocol = Schema.Struct({ type: Schema.Literal("hello"), protocol: Schema.Number })
const fromWorker = json(Schema.fromJsonString(FromWorker))
const toWorker = json(Schema.fromJsonString(ToWorker))

export const workerCodec: Frames.Codec<Exclude<FromWorker, Hello>, ToWorker> = {
  // A second hello is as bad as any other message that is not valid here.
  decode: (bytes) =>
    Effect.flatMap(fromWorker.decode(bytes), (message) =>
      message.type === "hello" ? Effect.fail(new Refused()) : Effect.succeed(message),
    ),
  encode: toWorker.encode,
}

const concat = (...parts: ReadonlyArray<Uint8Array>) => new Uint8Array(Buffer.concat(parts))

const same = (left: Uint8Array, right: Uint8Array) => Buffer.compare(left, right) === 0
