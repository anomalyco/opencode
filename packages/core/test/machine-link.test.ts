import { expect } from "bun:test"
import { randomBytes } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Identity } from "@opencode/core/machine/identity"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { Noise } from "@opencode/core/machine/noise"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Cause, Effect, Exit, Fiber, Option, Queue, Result, type Scope } from "effect"
import { TestClock } from "effect/testing"
import transcript from "./fixture/link-v1-transcript.json"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// Both sides of the link in memory, over a pair of queues, with the real Machines and Identity layers.

const text = (value: string) => new TextEncoder().encode(value)
const hex = (value: string) => new Uint8Array(Buffer.from(value, "hex"))
const toHex = (value: Uint8Array) => Buffer.from(value).toString("hex")
const concat = (...parts: ReadonlyArray<Uint8Array>) => new Uint8Array(Buffer.concat(parts))
const ok = <A, E>(result: Result.Result<A, E>) => Result.getOrThrow(result)
const flip = (message: Uint8Array, bit: number) => {
  const copy = message.slice()
  copy[bit >> 3] ^= 1 << (bit & 7)
  return copy
}
// One bit per byte, a different bit each time.
const everyByte = (message: Uint8Array) => Array.from({ length: message.length }, (_, byte) => byte * 8 + (byte % 8))
const refused = (result: Result.Result<unknown, Link.Refused>) =>
  expect(Result.isFailure(result) && result.failure).toEqual(new Link.Refused())
const newWorker = () => Identity.fromSeed(randomBytes(32))
const HOME_LABEL = text("opencode-link-v1/home:")
const MACHINE_LABEL = text("opencode-link-v1/machine:")

const layers = (directory: string) =>
  AppNodeBuilder.build(LayerNode.group([Database.node, Machines.node, Identity.node]), [
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
    ),
    Database.node.replace(Database.configured({ path: path.join(directory, "opencode.db") })),
  ])

/** A home of its own in a fresh directory, holding `seed` as its key when given and a key of its own otherwise. */
const home = <A, E>(body: Effect.Effect<A, E, Machines.Service | Identity.Service | Scope.Scope>, seed?: Uint8Array) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    if (seed)
      yield* Effect.promise(async () => {
        await mkdir(path.join(tmp.path, "machine"), { recursive: true })
        await writeFile(path.join(tmp.path, "machine", "home-key"), seed, { mode: 0o600 })
      })
    return yield* Effect.scoped(body).pipe(Effect.provide(layers(tmp.path), { local: true }))
  })

const invite = (machines: Machines.Interface, id: Environment.ID, replace = false) =>
  machines.invite(id, { reach: [], replace }).pipe(Effect.map((printed) => Option.getOrThrow(Join.decode(printed))))

/** Replaces a message on its way, or drops it and hangs up when it returns undefined. `index` counts per direction. */
type Tamper = (message: Uint8Array, index: number) => Uint8Array | undefined

interface Setup {
  readonly toHome?: Tamper
  readonly toWorker?: Tamper
  /** A home that holds another key, or signs what it should not. */
  readonly identity?: Identity.Interface
  readonly fixed?: Link.Fixed
}

/** Runs `Link.accept` against `dial`, returning each side's result and every message each side sent. */
const run = <A, E>(dial: (carrier: Link.Carrier) => Effect.Effect<A, E>, setup: Setup = {}) =>
  Effect.gen(function* () {
    const toHome = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const toWorker = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const sent = { byWorker: [] as Uint8Array[], byHome: [] as Uint8Array[] }
    // A side that refuses hangs up, as a socket would, so the other side's next read fails instead of waiting.
    const hangUp = Effect.all([Queue.end(toHome), Queue.end(toWorker)]).pipe(Effect.asVoid)
    const carrier = (
      inbox: Queue.Queue<Uint8Array, Cause.Done>,
      outbox: Queue.Queue<Uint8Array, Cause.Done>,
      log: Uint8Array[],
      tamper: Tamper | undefined,
    ): Link.Carrier => ({
      send: (message) =>
        Effect.suspend(() => {
          log.push(message)
          const delivered = tamper ? tamper(message, log.length - 1) : message
          return delivered ? Queue.offer(outbox, delivered).pipe(Effect.asVoid) : hangUp
        }),
      receive: Queue.take(inbox).pipe(Effect.mapError(() => new Link.Closed())),
    })
    const accept = Link.accept(carrier(toHome, toWorker, sent.byHome, setup.toWorker), setup.fixed)
    const [homeResult, workerResult] = yield* Effect.all(
      [
        (setup.identity ? accept.pipe(Effect.provideService(Identity.Service, setup.identity)) : accept).pipe(
          Effect.onError(() => hangUp),
          Effect.result,
        ),
        dial(carrier(toWorker, toHome, sent.byWorker, setup.toHome)).pipe(
          Effect.onError(() => hangUp),
          Effect.result,
        ),
      ],
      { concurrency: 2 },
    )
    return { home: homeResult, worker: workerResult, sent }
  })

const connect = (options: Link.DialOptions, setup?: Setup) => run((carrier) => Link.dial(carrier, options), setup)

/** A worker that skips every check of the home and writes message 3 as told, for payloads `dial` never writes. */
const forged = (worker: Identity.Key, flag: number, secret: Uint8Array) => (carrier: Link.Carrier) =>
  Effect.gen(function* () {
    const local = Noise.generateKeyPair()
    const noise = ok(Noise.handshake({ initiator: true, prologue: text("opencode-link-v1"), static: local }))
    yield* carrier.send(ok(noise.write(new Uint8Array(0))))
    ok(noise.read(yield* carrier.receive))
    const signature = worker.sign(concat(MACHINE_LABEL, local.publicKey, noise.hash ?? new Uint8Array(0)))
    yield* carrier.send(ok(noise.write(concat(worker.publicKey, signature, Uint8Array.of(flag), secret))))
    return ok(ok(noise.split()).receive.decrypt(yield* carrier.receive))
  })

/** Adds `gpu`, enrols a fresh worker for it over the link, and returns what a reconnect needs. */
const enrolled = Effect.gen(function* () {
  const machines = yield* Machines.Service
  const id = yield* machines.add("gpu")
  const printed = yield* invite(machines, id)
  const worker = newWorker()
  ok((yield* connect({ home: printed.home, identity: worker, secret: printed.secret })).worker)
  return { machines, id, home: printed.home, worker }
})

it.effect("enrols an invited machine and carries transport messages both ways", () =>
  home(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const id = yield* machines.add("gpu")
      const printed = yield* invite(machines, id)
      const worker = newWorker()
      const link = yield* connect({ home: printed.home, identity: worker, secret: printed.secret })
      const accepted = ok(link.home)
      const dialed = ok(link.worker)
      expect(accepted.machine).toBe(id)
      expect(dialed.machine).toBe("gpu")
      expect(yield* machines.identify(worker.publicKey)).toBe(id)
      expect((yield* machines.list()).map((machine) => machine.paired)).toEqual([true])
      // The Rust worker relies on these: messages 1 and 3 by the worker, message 2 by the home.
      expect(link.sent.byWorker.map((message) => message.length)).toEqual([32, 193])
      expect(link.sent.byHome[0]).toHaveLength(192)
      for (const round of [0, 1, 2]) {
        expect(ok(dialed.receive.decrypt(ok(accepted.send.encrypt(text(`down ${round}`)))))).toEqual(
          text(`down ${round}`),
        )
        expect(ok(accepted.receive.decrypt(ok(dialed.send.encrypt(text(`up ${round}`)))))).toEqual(text(`up ${round}`))
      }
    }),
  ),
)

it.effect("reconnects a paired worker without its secret and refuses a key it has never paired", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrolled
      const again = yield* connect({ home: paired.home, identity: paired.worker })
      expect(ok(again.home).machine).toBe(paired.id)
      expect(ok(again.worker).machine).toBe("gpu")
      // Same size as an enrolment, so a relay cannot tell the two apart.
      expect(again.sent.byWorker.map((message) => message.length)).toEqual([32, 193])

      const stranger = yield* connect({ home: paired.home, identity: newWorker() })
      refused(stranger.home)
      refused(stranger.worker)
      expect(stranger.sent.byHome).toHaveLength(1)
    }),
  ),
)

it.effect("lets a worker whose welcome was lost after pairing back in with the same secret", () =>
  home(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const id = yield* machines.add("gpu")
      const printed = yield* invite(machines, id)
      const worker = newWorker()
      const options = { home: printed.home, identity: worker, secret: printed.secret }
      const lost = yield* connect(options, {
        toWorker: (message, index) => (index === 1 ? undefined : message),
      })
      expect(ok(lost.home).machine).toBe(id)
      refused(lost.worker)
      expect(yield* machines.identify(worker.publicKey)).toBe(id)

      const retry = yield* connect(options)
      expect(ok(retry.home).machine).toBe(id)
      expect(ok(retry.worker).machine).toBe("gpu")
    }),
  ),
)

it.effect("takes a known key as a reconnect whatever secret it brings, and pairs a new key only with a secret", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrolled
      const box = yield* paired.machines.add("box")
      const printed = yield* invite(paired.machines, box)
      const known = yield* connect({ home: paired.home, identity: paired.worker, secret: printed.secret })
      expect(ok(known.home).machine).toBe(paired.id)
      // The invitation the paired worker presented is still good for the machine it was printed for.
      expect(
        ok((yield* connect({ home: paired.home, identity: newWorker(), secret: printed.secret })).home).machine,
      ).toBe(box)

      const replacement = yield* invite(paired.machines, paired.id, true)
      const next = newWorker()
      expect(ok((yield* connect({ home: paired.home, identity: next, secret: replacement.secret })).home).machine).toBe(
        paired.id,
      )
      expect(yield* paired.machines.identify(next.publicKey)).toBe(paired.id)
      refused((yield* connect({ home: paired.home, identity: paired.worker })).home)
    }),
  ),
)

it.effect("never writes message 3 to a home that does not prove the pinned key", () =>
  home(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const identity = yield* Identity.Service
      const id = yield* machines.add("gpu")
      const printed = yield* invite(machines, id)
      const worker = newWorker()
      const other = newWorker()
      const impostors: ReadonlyArray<Identity.Interface> = [
        // A valid signature by a key that is not the pinned one.
        { publicKey: () => Effect.succeed(other.publicKey), sign: (bytes) => Effect.succeed(other.sign(bytes)) },
        // The pinned key, with a signature another key made.
        { publicKey: () => identity.publicKey(), sign: (bytes) => Effect.succeed(other.sign(bytes)) },
      ]
      for (const impostor of impostors) {
        const link = yield* connect(
          { home: printed.home, identity: worker, secret: printed.secret },
          { identity: impostor },
        )
        refused(link.worker)
        refused(link.home)
        expect(link.sent.byWorker).toHaveLength(1)
      }
      // The impostors ran on this home's Machines, so the secret would be spent had it reached them.
      expect(
        ok((yield* connect({ home: printed.home, identity: worker, secret: printed.secret })).worker).machine,
      ).toBe("gpu")
    }),
  ),
)

it.effect("refuses a signature from another handshake, over the static key alone, or under the other label", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrolled
      const identity = yield* Identity.Service
      const options = { home: paired.home, identity: paired.worker }

      // Each side keeps its Noise static across the two handshakes, so only the transcript differs.
      const homeStatic = Noise.generateKeyPair()
      const homeSignatures: Uint8Array[] = []
      const recorded = yield* connect(options, {
        fixed: { static: homeStatic },
        identity: {
          publicKey: () => identity.publicKey(),
          sign: (bytes) =>
            identity.sign(bytes).pipe(Effect.tap((signature) => Effect.sync(() => homeSignatures.push(signature)))),
        },
      })
      ok(recorded.worker)
      const homeReplay = yield* connect(options, {
        fixed: { static: homeStatic },
        identity: { publicKey: () => identity.publicKey(), sign: () => Effect.succeed(homeSignatures[0]) },
      })
      refused(homeReplay.worker)
      expect(homeReplay.sent.byWorker).toHaveLength(1)

      const workerStatic = Noise.generateKeyPair()
      const workerSignatures: Uint8Array[] = []
      ok(
        (yield* connect({
          ...options,
          static: workerStatic,
          identity: {
            publicKey: paired.worker.publicKey,
            sign: (bytes) => {
              const signature = paired.worker.sign(bytes)
              workerSignatures.push(signature)
              return signature
            },
          },
        })).home,
      )
      const workerReplay = yield* connect({
        ...options,
        static: workerStatic,
        identity: { publicKey: paired.worker.publicKey, sign: () => workerSignatures[0] },
      })
      refused(workerReplay.home)
      expect(workerReplay.sent.byHome).toHaveLength(1)

      const label = HOME_LABEL.length
      for (const sign of [
        (bytes: Uint8Array) => identity.sign(bytes.subarray(label, label + 32)),
        (bytes: Uint8Array) => identity.sign(concat(MACHINE_LABEL, bytes.subarray(label))),
      ]) {
        const link = yield* connect(options, { identity: { publicKey: () => identity.publicKey(), sign } })
        refused(link.worker)
        expect(link.sent.byWorker).toHaveLength(1)
      }
      const machineLabel = MACHINE_LABEL.length
      for (const sign of [
        (bytes: Uint8Array) => paired.worker.sign(bytes.subarray(machineLabel, machineLabel + 32)),
        (bytes: Uint8Array) => paired.worker.sign(concat(HOME_LABEL, bytes.subarray(machineLabel))),
      ]) {
        const link = yield* connect({ ...options, identity: { publicKey: paired.worker.publicKey, sign } })
        refused(link.home)
        expect(link.sent.byHome).toHaveLength(1)
      }
    }),
  ),
)

it.effect("refuses a wrong, expired or spent secret alike, sending nothing after message 2", () =>
  home(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const id = yield* machines.add("gpu")
      const printed = yield* invite(machines, id)
      const dial = (secret: Uint8Array) => connect({ home: printed.home, identity: newWorker(), secret })
      const wrong = yield* dial(randomBytes(32))
      yield* TestClock.adjust("6 minutes")
      const expired = yield* dial(printed.secret)
      // The machine is paired now, and its spent secret comes back with another key.
      const fresh = yield* invite(machines, id)
      ok((yield* connect({ home: fresh.home, identity: newWorker(), secret: fresh.secret })).home)
      const spent = yield* dial(fresh.secret)
      for (const link of [wrong, expired, spent]) {
        refused(link.home)
        refused(link.worker)
        expect(link.sent.byHome).toHaveLength(1)
      }
    }),
  ),
)

it.effect("refuses each handshake message one byte short or long, and any has_secret but 0 or 1", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrolled
      const options = { home: paired.home, identity: paired.worker }
      const resized = [
        (message: Uint8Array) => message.subarray(0, message.length - 1),
        (message: Uint8Array) => concat(message, new Uint8Array(1)),
      ]
      for (const resize of resized) {
        // Message 1 is refused before the home writes anything.
        const first = yield* connect(options, { toHome: (message, index) => (index === 0 ? resize(message) : message) })
        refused(first.home)
        expect(first.sent.byHome).toHaveLength(0)
        const second = yield* connect(options, {
          toWorker: (message, index) => (index === 0 ? resize(message) : message),
        })
        refused(second.worker)
        expect(second.sent.byWorker).toHaveLength(1)
        const third = yield* connect(options, { toHome: (message, index) => (index === 1 ? resize(message) : message) })
        refused(third.home)
        expect(third.sent.byHome).toHaveLength(1)
      }

      const short = yield* connect({ ...options, secret: new Uint8Array(31) })
      refused(short.worker)
      expect(short.sent.byWorker).toHaveLength(0)

      // The forged worker writes a message 3 the home accepts when its fields are right.
      expect(ok((yield* run(forged(paired.worker, 0, new Uint8Array(32)))).worker)).toEqual(text("gpu"))
      const fresh = yield* invite(paired.machines, yield* paired.machines.add("box"))
      for (const [worker, flag, secret] of [
        [newWorker(), 2, fresh.secret],
        [paired.worker, 2, new Uint8Array(32)],
        [paired.worker, 0, new Uint8Array(32).fill(1)],
      ] as const) {
        const link = yield* run(forged(worker, flag, secret))
        refused(link.home)
        expect(link.sent.byHome).toHaveLength(1)
      }
      expect(ok((yield* run(forged(newWorker(), 1, fresh.secret))).worker)).toEqual(text("box"))
    }),
  ),
)

it.effect("refuses a flipped bit in any byte of message 2, message 3 or the welcome", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrolled
      const options = { home: paired.home, identity: paired.worker }
      const sample = (yield* connect(options)).sent
      for (const bit of everyByte(sample.byHome[0])) {
        const link = yield* connect(options, {
          toWorker: (message, index) => (index === 0 ? flip(message, bit) : message),
        })
        refused(link.worker)
        expect(link.sent.byWorker).toHaveLength(1)
      }
      for (const bit of everyByte(sample.byWorker[1])) {
        const link = yield* connect(options, {
          toHome: (message, index) => (index === 1 ? flip(message, bit) : message),
        })
        refused(link.home)
        expect(link.sent.byHome).toHaveLength(1)
      }
      for (const bit of everyByte(sample.byHome[1])) {
        const link = yield* connect(options, {
          toWorker: (message, index) => (index === 1 ? flip(message, bit) : message),
        })
        expect(ok(link.home).machine).toBe(paired.id)
        refused(link.worker)
      }
    }),
  ),
)

it.effect("refuses a peer that sends message 1 and then nothing, after 10 seconds and not before", () =>
  home(
    Effect.gen(function* () {
      const toHome = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const toWorker = yield* Queue.unbounded<Uint8Array>()
      const accepting = yield* Effect.forkChild(
        Link.accept({
          send: (message) => Queue.offer(toWorker, message).pipe(Effect.asVoid),
          receive: Queue.take(toHome).pipe(Effect.mapError(() => new Link.Closed())),
        }),
        { startImmediately: true },
      )
      const noise = ok(
        Noise.handshake({ initiator: true, prologue: text("opencode-link-v1"), static: Noise.generateKeyPair() }),
      )
      yield* Queue.offer(toHome, ok(noise.write(new Uint8Array(0))))
      // Message 2 has been sent, so the home now waits on message 3.
      yield* Queue.take(toWorker)
      yield* TestClock.adjust("9999 millis")
      expect(accepting.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 millis")
      expect(yield* Fiber.join(accepting).pipe(Effect.flip)).toEqual(new Link.Refused())
    }),
  ),
)

it.effect("stays interrupted when its caller interrupts it, on either side", () =>
  home(
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      const silent: Link.Carrier = { send: () => Effect.void, receive: Effect.never }
      for (const side of [
        Link.accept(silent),
        Link.dial(silent, { home: yield* identity.publicKey(), identity: newWorker() }),
      ]) {
        const fiber = yield* Effect.forkChild(side, { startImmediately: true })
        const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)))
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      }
    }),
  ),
)

// The transcript the Rust worker must reproduce byte for byte. It was generated once by running both sides of
// link.ts with the inputs in the fixture, which fix every key and the secret (Ed25519 signatures are deterministic),
// and recording the four messages. Regenerate it only for a new protocol version, never to make this test pass.
it.effect("reproduces the pinned v1 transcript", () => {
  const inputs = transcript.inputs
  return home(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const identity = yield* Identity.Service
      const id = yield* machines.add(inputs.machine)
      const worker = Identity.fromSeed(hex(inputs.worker_seed))
      const printed = yield* invite(machines, id)
      // Real invitations are random, so the worker is paired first. The pinned secret is then unknown to the home,
      // which lets the paired key in, the same path a lost welcome takes: message 3 still carries the secret.
      yield* connect({ home: printed.home, identity: worker, secret: printed.secret })
      const link = yield* connect(
        {
          home: printed.home,
          identity: worker,
          secret: hex(inputs.secret),
          static: ok(Noise.keyPair(hex(inputs.worker_static))),
          ephemeral: ok(Noise.keyPair(hex(inputs.worker_ephemeral))),
        },
        {
          fixed: {
            static: ok(Noise.keyPair(hex(inputs.home_static))),
            ephemeral: ok(Noise.keyPair(hex(inputs.home_ephemeral))),
          },
        },
      )
      expect(ok(link.worker).machine).toBe(inputs.machine)
      expect({
        home_identity: toHex(yield* identity.publicKey()),
        worker_identity: toHex(worker.publicKey),
        message_1: toHex(link.sent.byWorker[0]),
        message_2: toHex(link.sent.byHome[0]),
        message_3: toHex(link.sent.byWorker[1]),
        welcome: toHex(link.sent.byHome[1]),
      }).toEqual(transcript.outputs)
    }),
    hex(inputs.home_seed),
  )
})
