export * as Identity from "./identity.js"

import crypto from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { KV } from "../kv.js"

const FILE = path.join("machine", "home-key")
const KV_KEY = "machine.home-key"
const SEED_BYTES = 32
const KEY_BYTES = 32
const SIGNATURE_BYTES = 64
// PKCS8 and SPKI DER wrap an Ed25519 key with a fixed prefix each, so the file itself stays a raw 32-byte seed.
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex")
const SPKI = Buffer.from("302a300506032b6570032100", "hex")

export class InvalidKey extends Schema.TaggedError<InvalidKey>()("Identity.InvalidKey", {
  file: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Cannot use the home key at ${this.file}: ${this.reason}. Every paired machine trusts this key, so it is never replaced.`
  }
}

export interface Interface {
  readonly publicKey: () => Effect.Effect<Uint8Array, InvalidKey>
  readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, InvalidKey>
  /** The raw 32-byte seed, for the home's Iroh endpoint, whose endpoint id is then the home's public key. */
  readonly seed: () => Effect.Effect<Uint8Array, InvalidKey>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Identity") {}

const invalid = (file: string, reason: string) => new InvalidKey({ file, reason })

const code = (cause: unknown) => (cause instanceof Error && "code" in cause ? cause.code : undefined)

/** An Ed25519 key that can sign: the home's, or a worker's on its side of the link. */
export interface Key {
  readonly publicKey: Uint8Array
  readonly sign: (bytes: Uint8Array) => Uint8Array
}

/**
 * The key of a raw 32-byte Ed25519 seed. Any other length is a programmer error and throws: callers check it first,
 * as the home key's loader does with its own message.
 */
export const fromSeed = (seed: Uint8Array): Key => {
  // The runtime would ignore bytes past the DER it expects and use the first 32.
  if (seed.length !== SEED_BYTES) throw new RangeError(`An Ed25519 seed is ${SEED_BYTES} bytes, not ${seed.length}`)
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" })
  return {
    publicKey: new Uint8Array(
      crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(SPKI.length),
    ),
    sign: (bytes) => new Uint8Array(crypto.sign(null, bytes, privateKey)),
  }
}

/**
 * Whether `signature` is `publicKey`'s Ed25519 signature of `bytes`: false, never a throw, for a malformed key or
 * signature.
 *
 * Like this runtime, it accepts small-order and non-canonically encoded public keys, which a strict verifier refuses.
 * That is deliberate: a worker's key is chosen by whoever holds its invitation, and choosing a key anyone can sign for
 * is no more than publishing its own private key. The home's key is real, and honest signatures verify either way.
 */
export const verify = (publicKey: Uint8Array, bytes: Uint8Array, signature: Uint8Array) => {
  // The runtime ignores bytes past a key's DER, so a longer key would verify as its first 32 bytes.
  if (publicKey.length !== KEY_BYTES || signature.length !== SIGNATURE_BYTES) return false
  try {
    return crypto.verify(
      null,
      bytes,
      crypto.createPublicKey({ key: Buffer.concat([SPKI, publicKey]), format: "der", type: "spki" }),
      signature,
    )
  } catch {
    return false
  }
}

const read = (file: string) =>
  Effect.tryPromise({
    try: () => readFile(file),
    catch: (cause) => cause,
  })

const generateSeed = () => new Uint8Array(crypto.randomBytes(SEED_BYTES))

const create = (file: string) =>
  Effect.gen(function* () {
    const seed = generateSeed()
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
        // `wx` never replaces a key another process wrote first: this call fails and the next one reads that key.
        await writeFile(file, seed, { flag: "wx", mode: 0o600 })
      },
      catch: (cause) => invalid(file, `could not be created: ${String(cause)}`),
    })
    return seed
  })

const load = (file: string) =>
  Effect.gen(function* () {
    const seed = yield* read(file).pipe(
      Effect.catchIf(
        (cause) => code(cause) === "ENOENT",
        () => create(file),
      ),
      Effect.mapError((cause) =>
        cause instanceof InvalidKey ? cause : invalid(file, `could not be read: ${String(cause)}`),
      ),
    )
    if (seed.length !== SEED_BYTES)
      return yield* invalid(file, `expected a ${SEED_BYTES}-byte key, found ${seed.length} bytes`)
    if (process.platform !== "win32") {
      const mode = (yield* Effect.tryPromise({
        try: () => stat(file),
        catch: (cause) => invalid(file, `could not be read: ${String(cause)}`),
      })).mode
      // Like ssh: a key another user can read is no key at all.
      if (mode & 0o077)
        return yield* invalid(
          file,
          `its mode ${(mode & 0o777).toString(8)} lets other users read it; run "chmod 600 ${file}"`,
        )
    }
    return { ...fromSeed(seed), seed: new Uint8Array(seed) }
  })

type Loaded = Key & { readonly seed: Uint8Array }

const makeService = (loadKey: Effect.Effect<Loaded, InvalidKey>) => {
  const lock = Semaphore.makeUnsafe(1)
  // Success only: a failed load is tried again next call, so a fixed key works without a restart.
  let loaded: Loaded | undefined
  const current = Effect.suspend(() =>
    loaded
      ? Effect.succeed(loaded)
      : lock.withPermits(1)(
          Effect.suspend(() =>
            loaded ? Effect.succeed(loaded) : Effect.tap(loadKey, (key) => Effect.sync(() => (loaded = key))),
          ),
        ),
  )
  return Service.of({
    publicKey: () => Effect.map(current, (key) => key.publicKey),
    sign: (bytes) => Effect.map(current, (key) => key.sign(bytes)),
    seed: () => Effect.map(current, (key) => new Uint8Array(key.seed)),
  })
}

const loadFromKv = Effect.fnUntraced(function* (kv: KV.Interface) {
  const existing = yield* kv.get(KV_KEY)
  if (existing === undefined) {
    const seed = generateSeed()
    yield* kv.set(KV_KEY, Buffer.from(seed).toString("base64url"))
    return { ...fromSeed(seed), seed }
  }
  if (typeof existing !== "string") return yield* invalid(KV_KEY, "stored home key is not a string")
  const seed = Buffer.from(existing, "base64url")
  // Buffer.from(..., "base64url") silently ignores non-base64url characters, so verify an exact round-trip.
  if (seed.length !== SEED_BYTES || Buffer.from(seed).toString("base64url") !== existing)
    return yield* invalid(KV_KEY, `expected a ${SEED_BYTES}-byte base64url key`)
  return { ...fromSeed(seed), seed: new Uint8Array(seed) }
})

const layer = Layer.effect(
  Service,
  Effect.map(Global.Service, (global) => makeService(load(path.join(global.state, FILE)))),
)

/** Persistent identity stored in `KV.Service` (base64url seed) for runtimes without local disk (e.g. workerd). */
export const kvLayer = Layer.effect(
  Service,
  Effect.map(KV.Service, (kv) => makeService(loadFromKv(kv))),
)

export const kvNode = makeGlobalNode({ service: Service, layer: kvLayer, deps: [KV.node] })

export const node = makeGlobalNode({ service: Service, layer, deps: [Global.node] })
