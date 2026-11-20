import { describe, expect, test } from "bun:test"
import { createPublicKey, verify } from "node:crypto"
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Identity } from "@opencode/core/machine/identity"
import { Join } from "@opencode/core/machine/join"
import { Global } from "@opencode/util/global"
import { Effect, Option } from "effect"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const bytes = (size: number, fill: number) => new Uint8Array(size).fill(fill)
const base64url = (value: Uint8Array) => Buffer.from(value).toString("base64url")
const url = (value: string) => ({ type: "url" as const, url: value })

const value = {
  v: 1 as const,
  home: bytes(32, 1),
  secret: bytes(32, 2),
  expires: 1_767_225_600_000,
  reach: [url("https://home.example")],
}

const encodeRaw = (wire: Record<string, unknown>) =>
  `ocjoin_${Buffer.from(
    JSON.stringify({
      v: 1,
      home: base64url(value.home),
      secret: base64url(value.secret),
      expires: value.expires,
      reach: value.reach,
      ...wire,
    }),
  ).toString("base64url")}`

// Also a test vector for the Rust worker: this exact string must keep decoding to `value`.
const literal =
  "ocjoin_eyJ2IjoxLCJob21lIjoiQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRSIsInNlY3JldCI6IkFnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0kiLCJleHBpcmVzIjoxNzY3MjI1NjAwMDAwLCJyZWFjaCI6W3sidHlwZSI6InVybCIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dfQ"

describe("Join", () => {
  test("encodes and decodes its fields", () => {
    expect(Join.encode(value)).toBe(literal)
    expect(Join.decode(literal)).toEqual(Option.some(value))
  })

  test("rejects a wrong prefix", () => {
    expect(Join.decode(literal.replace("ocjoin_", "opencode_"))).toEqual(Option.none())
  })

  test("rejects a wrong version, key length or secret length", () => {
    for (const wire of [
      { v: 2 },
      { home: base64url(bytes(31, 1)) },
      { secret: base64url(bytes(33, 2)) },
      { expires: "soon" },
    ])
      expect(Join.decode(encodeRaw(wire))).toEqual(Option.none())
  })

  test("rejects a string longer than 4096 characters before decoding", () => {
    const long = encodeRaw({ reach: [url(`https://home.example/${"a".repeat(4_000)}`)] })
    expect(long.length).toBeGreaterThan(4_096)
    expect(Join.decode(long)).toEqual(Option.none())
  })

  test("rejects base64url that is not canonical", () => {
    expect(Join.decode(`${encodeRaw({})}=`)).toEqual(Option.none())
  })

  test("rejects an expiry that is not a non-negative safe integer", () => {
    for (const expires of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "soon"])
      expect(Join.decode(encodeRaw({ expires }))).toEqual(Option.none())
  })

  test("drops a reach entry this worker cannot use and keeps the ones it can", () => {
    const decoded = Option.getOrThrow(
      Join.decode(encodeRaw({ reach: [{ type: "carrier", band: "x" }, url("https://home.example")] })),
    )
    expect(decoded.reach).toEqual([url("https://home.example")])
  })
})

const global = (directory: string) =>
  Global.node.replace(
    Global.layerWith({
      data: directory,
      cache: directory,
      config: directory,
      state: directory,
      tmp: directory,
      bin: directory,
      log: directory,
      repos: directory,
    }),
  )

// The key never lives in the database, so every identity test starts from a directory of its own.
const identityLayers = (directory: string) => AppNodeBuilder.build(Identity.node, [global(directory)])

const publicKey = () =>
  Effect.scoped(
    Effect.gen(function* () {
      return yield* (yield* Identity.Service).publicKey()
    }),
  )

it.effect("creates the home key on first use, keeps it across a rebuild, and signs with it", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const directory = path.join(tmp.path, "state")
    const file = path.join(directory, "machine", "home-key")
    const first = yield* publicKey().pipe(Effect.provide(identityLayers(directory), { local: true }))
    const info = yield* Effect.promise(() => stat(file))
    expect(info.size).toBe(32)
    // Windows has no file mode.
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600)
    expect(yield* publicKey().pipe(Effect.provide(identityLayers(directory), { local: true }))).toEqual(first)

    const signed = yield* Effect.scoped(
      Effect.gen(function* () {
        const identity = yield* Identity.Service
        return yield* identity.sign(new TextEncoder().encode("hello"))
      }),
    ).pipe(Effect.provide(identityLayers(directory), { local: true }))
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(first).toString("base64url") },
      format: "jwk",
    })
    expect(verify(null, new TextEncoder().encode("hello"), key, signed)).toBe(true)
  }),
)

describe("Identity", () => {
  // This runtime ignores trailing DER bytes, so without the length checks the first 32 bytes of a longer key would do.
  test("makes a key only from a 32-byte seed", () => {
    expect(Identity.fromSeed(bytes(32, 1)).publicKey).toHaveLength(32)
    for (const size of [31, 33, 64]) expect(() => Identity.fromSeed(bytes(size, 1))).toThrow()
  })

  test("verifies only a 32-byte key and a 64-byte signature", () => {
    const key = Identity.fromSeed(bytes(32, 1))
    const message = new TextEncoder().encode("hello")
    const signature = key.sign(message)
    expect(Identity.verify(key.publicKey, message, signature)).toBe(true)
    for (const size of [31, 33, 64]) {
      const resized = new Uint8Array(size)
      resized.set(key.publicKey.subarray(0, Math.min(size, 32)))
      expect(Identity.verify(resized, message, signature)).toBe(false)
    }
    for (const size of [31, 33, 65]) {
      const resized = new Uint8Array(size)
      resized.set(signature.subarray(0, Math.min(size, 64)))
      expect(Identity.verify(key.publicKey, message, resized)).toBe(false)
    }
  })
})

it.effect("fails an unusable key file without replacing it", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const directory = path.join(tmp.path, "state")
    const file = path.join(directory, "machine", "home-key")
    yield* Effect.promise(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes(31, 1))
    })
    const error = yield* publicKey().pipe(Effect.provide(identityLayers(directory), { local: true }), Effect.flip)
    expect(error).toBeInstanceOf(Identity.InvalidKey)
    expect(error.message).toContain("expected a 32-byte key, found 31 bytes")
    expect((yield* Effect.promise(() => readFile(file))).byteLength).toBe(31)
  }),
)

it.effect("refuses a key file other users can read and leaves it alone", () =>
  Effect.gen(function* () {
    // Windows has no file mode.
    if (process.platform === "win32") return
    const tmp = yield* tmpdirScoped()
    const directory = path.join(tmp.path, "state")
    const file = path.join(directory, "machine", "home-key")
    yield* Effect.promise(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes(32, 3))
      await chmod(file, 0o644)
    })
    const error = yield* publicKey().pipe(Effect.provide(identityLayers(directory), { local: true }), Effect.flip)
    expect(error).toBeInstanceOf(Identity.InvalidKey)
    expect(error.message).toContain(`chmod 600 ${file}`)
    expect(yield* Effect.promise(() => readFile(file))).toEqual(Buffer.from(bytes(32, 3)))
    expect((yield* Effect.promise(() => stat(file))).mode & 0o777).toBe(0o644)
  }),
)

it.effect("loads again after a failed load once the key file is fixed, without a rebuild", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const directory = path.join(tmp.path, "state")
    const file = path.join(directory, "machine", "home-key")
    yield* Effect.promise(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes(31, 1))
    })
    const fixed = yield* Effect.scoped(
      Effect.gen(function* () {
        const identity = yield* Identity.Service
        expect(yield* identity.publicKey().pipe(Effect.flip)).toBeInstanceOf(Identity.InvalidKey)
        yield* Effect.promise(async () => {
          await writeFile(file, bytes(32, 4))
          await chmod(file, 0o600)
        })
        return yield* identity.publicKey()
      }),
    ).pipe(Effect.provide(identityLayers(directory), { local: true }))
    expect(fixed).toEqual(yield* publicKey().pipe(Effect.provide(identityLayers(directory), { local: true })))
  }),
)
