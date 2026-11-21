import { expect } from "bun:test"
import { randomBytes } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Frames } from "@opencode/core/machine/frames"
import { Identity } from "@opencode/core/machine/identity"
import { Machine } from "@opencode/core/machine/index"
import { Join } from "@opencode/core/machine/join"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { Noise } from "@opencode/core/machine/noise"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Queue, Result, Schema, Scope, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import transcript from "./fixture/link-v1-transcript.json"
import { makeWorker } from "./fixture/machine-worker"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// The link from the driver to a worker, both sides in memory over a pair of queues, with the real Machines, Identity
// and database layers.

const text = (value: string) => new TextEncoder().encode(value)
const hex = (value: string) => new Uint8Array(Buffer.from(value, "hex"))
const toHex = (value: Uint8Array) => Buffer.from(value).toString("hex")
const concat = (...parts: ReadonlyArray<Uint8Array>) => new Uint8Array(Buffer.concat(parts))
const ok = <A, E>(result: Result.Result<A, E>) => Result.getOrThrow(result)
const newWorker = () => Identity.fromSeed(randomBytes(32))
const flip = (message: Uint8Array, bit: number) => {
  const copy = message.slice()
  copy[bit >> 3] ^= 1 << (bit & 7)
  return copy
}
const contains = (haystack: Uint8Array, needle: Uint8Array) => Buffer.from(haystack).includes(Buffer.from(needle))
const PIECE = 65_535 - 16 - 1

const HELLO: Machine.Hello = {
  type: "hello",
  protocol: 1,
  os: "linux",
  arch: "x64",
  home: "/home/worker",
  instance: Machine.Instance.make("instance"),
  processes: [],
}
const started = (id: string): Extract<Machine.FromWorker, { type: "started" }> => ({
  type: "started",
  id: Machine.ProcessID.make(id),
  pid: 1,
})
const release = (id: string): Machine.ToWorker => ({ type: "release", id: Machine.ProcessID.make(id) })

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

/** Replaces a message on its way, or drops it when it returns undefined. `index` counts per direction. */
type Tamper = (message: Uint8Array, index: number) => Uint8Array | undefined

/**
 * Both ends of a carrier over queues. Logs every message each side sends, before any tampering, and counts the reads
 * still waiting on either end.
 */
const wires = (setup: { readonly toHome?: Tamper; readonly toWorker?: Tamper } = {}) =>
  Effect.gen(function* () {
    const toHome = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const toWorker = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const sent = { byWorker: [] as Uint8Array[], byHome: [] as Uint8Array[] }
    const reads = { waiting: 0 }
    const end = (
      inbox: Queue.Queue<Uint8Array, Cause.Done>,
      outbox: Queue.Queue<Uint8Array, Cause.Done>,
      log: Uint8Array[],
      tamper: Tamper | undefined,
    ): Link.Carrier => ({
      send: (message) =>
        Effect.suspend(() => {
          log.push(message)
          const delivered = tamper ? tamper(message, log.length - 1) : message
          return delivered ? Queue.offer(outbox, delivered).pipe(Effect.asVoid) : Effect.void
        }),
      receive: Effect.suspend(() => {
        reads.waiting++
        return Queue.take(inbox)
      }).pipe(
        Effect.ensuring(Effect.sync(() => reads.waiting--)),
        Effect.mapError(() => new Link.Closed()),
      ),
    })
    return {
      home: end(toHome, toWorker, sent.byHome, setup.toWorker),
      worker: end(toWorker, toHome, sent.byWorker, setup.toHome),
      sent,
      reads,
      hangUp: Effect.all([Queue.end(toHome), Queue.end(toWorker)]).pipe(Effect.asVoid),
    }
  })

type Wires = Effect.Success<ReturnType<typeof wires>>

const invite = (machines: Machines.Interface, id: Environment.ID) =>
  machines.invite(id, { reach: [] }).pipe(Effect.map((printed) => Option.getOrThrow(Join.decode(printed))))

/** Adds `name` and pairs a fresh worker key with it over the link. */
const enrol = (name: string) =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add(name)
    const printed = yield* invite(machines, id)
    const worker = newWorker()
    yield* Effect.scoped(linked({ home: printed.home, identity: worker, secret: printed.secret }))
    return { machines, id, home: printed.home, worker }
  })

type Paired = Effect.Success<ReturnType<typeof enrol>>

/** `Link.serve` against `Link.connect`, the worker sending its hello first. */
const linked = (
  options: Link.DialOptions,
  setup: { readonly wires?: Wires; readonly fixed?: Link.Fixed; readonly hello?: Machine.Hello } = {},
) =>
  Effect.gen(function* () {
    const carrier = setup.wires ?? (yield* wires())
    const serving = yield* Effect.forkChild(Link.serve(carrier.home, setup.fixed), { startImmediately: true })
    const worker = yield* Link.connect(carrier.worker, options)
    worker.send(setup.hello ?? HELLO)
    return { carrier, served: yield* Fiber.join(serving), worker }
  })

/** A worker that skips `Link.connect` and writes frames as told, for frames and messages it never writes. */
const raw = (carrier: Wires, options: Link.DialOptions) =>
  Effect.gen(function* () {
    const dialed = yield* Link.dial(carrier.worker, options)
    const frame = (plaintext: Uint8Array) =>
      Effect.flatMap(Effect.fromResult(dialed.send.encrypt(plaintext)), carrier.worker.send)
    return {
      frame,
      message: (message: Machine.FromWorker) =>
        frame(concat(Uint8Array.of(0), text(JSON.stringify(Schema.encodeSync(Machine.FromWorker)(message))))),
      /** `bytes` as `more` pieces and a final one, whatever its length. */
      pieces: (bytes: Uint8Array) =>
        Effect.forEach(
          Array.from({ length: Math.ceil(bytes.length / PIECE) }, (_, index) => index * PIECE),
          (offset) =>
            frame(
              concat(Uint8Array.of(offset + PIECE >= bytes.length ? 0 : 1), bytes.subarray(offset, offset + PIECE)),
            ),
          { discard: true },
        ),
    }
  })

/** A paired worker writing raw frames to a home serving it, once both handshakes and the hello are through. */
const served = (paired: Paired, setup: { readonly toHome?: Tamper; readonly toWorker?: Tamper } = {}) =>
  Effect.gen(function* () {
    const carrier = yield* wires(setup)
    const serving = yield* Effect.forkChild(Link.serve(carrier.home), { startImmediately: true })
    const worker = yield* raw(carrier, { home: paired.home, identity: paired.worker })
    yield* worker.message(HELLO)
    return { carrier, worker, served: yield* Fiber.join(serving) }
  })

const collect = Stream.runCollect

/** Ciphers that change nothing, so a test reads each frame's plaintext on the carrier and writes frames itself. */
const plain: Frames.Ciphers = {
  send: { encrypt: (plaintext) => Result.succeed(plaintext) },
  receive: { decrypt: (ciphertext) => Result.succeed(ciphertext) },
}
const strings: Frames.Codec<string, string> = {
  decode: (bytes) => Effect.succeed(new TextDecoder().decode(bytes)),
  encode: (message) => Effect.succeed(text(message)),
}
const final = (message: string) => concat(Uint8Array.of(0), text(message))
/** The effect's result, or none if it is still waiting a second later on the test clock. */
const withinASecond = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.timeoutOption(effect, "1 second"), { startImmediately: true })
    yield* TestClock.adjust("1 second")
    return yield* Fiber.join(fiber)
  })

/**
 * A fake worker (test/fixture/machine-worker.ts) whose every connection runs over its own encrypted link: the worker
 * end through `Link.connect`, the home end through `Link.serve` and then `Machines.connect` with the id it proved.
 */
const tunnelled = (options: Link.DialOptions) =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    // The fake worker runs its connections with no services of their own.
    const services = yield* Effect.context<Machines.Service | Identity.Service>()
    const carriers: Wires[] = []
    const online = yield* Deferred.make<void>()
    const worker = yield* makeWorker({
      connect: (connection) =>
        Effect.scoped(
          Effect.gen(function* () {
            const carrier = yield* wires()
            carriers.push(carrier)
            const link = yield* linked(options, { wires: carrier, hello: connection.hello })
            yield* Effect.forkScoped(
              Stream.runForEach(link.worker.messages, (message) => Effect.sync(() => connection.send(message))),
            )
            yield* Effect.forkScoped(
              Stream.runForEach(connection.messages, (message) => Effect.sync(() => link.worker.send(message))).pipe(
                Effect.andThen(carrier.hangUp),
              ),
            )
            const serving = yield* Effect.forkChild(machines.connect(link.served.machine, link.served.connection), {
              startImmediately: true,
            })
            yield* Deferred.succeed(online, undefined)
            yield* Fiber.join(serving)
          }),
        ).pipe(Effect.provide(services)),
    })
    yield* worker.restore
    yield* Deferred.await(online)
    return { worker, files: Environment.makeFiles(worker.files), carriers }
  })

it.effect("runs a command and reads a file through the link, with only ciphertext on the carrier", () =>
  home(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const id = yield* machines.add("gpu")
      const printed = yield* invite(machines, id)
      const MARKER = "plaintext-marker-5f1c"
      const tunnel = yield* tunnelled({
        home: printed.home,
        identity: newWorker(),
        secret: printed.secret,
      })
      const environment = yield* machines.get(id)
      const handle = yield* environment.spawner.spawn(
        ChildProcess.make("/bin/echo", [MARKER], { cwd: `/work/${MARKER}` }),
      )
      const run = tunnel.worker.runs[0]
      expect([run.argv, run.cwd]).toEqual([["/bin/echo", MARKER], `/work/${MARKER}`])
      yield* run.print(`${MARKER}\n`)
      yield* run.exit(0)
      expect(yield* Stream.mkString(Stream.decodeText(handle.all))).toBe(`${MARKER}\n`)
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
      yield* tunnel.files.mkdir(`/work/${MARKER}`)
      yield* environment.files.write(`/work/${MARKER}/note`, text(`${MARKER}\n`))
      expect((yield* environment.files.read(`/work/${MARKER}/note`)).bytes).toEqual(text(`${MARKER}\n`))
      expect((yield* machines.list()).map((machine) => [machine.id, machine.online, machine.paired])).toEqual([
        [id, true, true],
      ])

      const sent = tunnel.carriers.flatMap((carrier) => [...carrier.sent.byHome, ...carrier.sent.byWorker])
      // The handshake and the welcome, then the hello, started, output, exit and two fs replies up, and the start,
      // release, write and read down.
      expect(sent.length).toBe(3 + 1 + 10)
      for (const plain of [MARKER, Buffer.from(`${MARKER}\n`).toString("base64"), '"type"', "hello", "gpu"])
        expect(sent.filter((message) => contains(message, text(plain)))).toEqual([])
    }),
  ),
)

it.effect("serves a worker as the machine it paired as, whatever its hello says", () =>
  home(
    Effect.gen(function* () {
      const gpu = yield* enrol("gpu")
      const box = yield* enrol("box")
      const carrier = yield* wires()
      const serving = yield* Effect.forkChild(Link.serve(carrier.home), { startImmediately: true })
      const worker = yield* raw(carrier, { home: box.home, identity: box.worker })
      // A hello written by hand, naming the other machine.
      const claim = { ...Schema.encodeSync(Machine.Hello)(HELLO), name: "gpu", machine: "gpu" }
      yield* worker.frame(concat(Uint8Array.of(0), text(JSON.stringify(claim))))
      const link = yield* Fiber.join(serving)
      expect(link.machine).toBe(box.id)
      expect(link.connection.hello).toEqual(HELLO)
      yield* Effect.forkChild(box.machines.connect(link.machine, link.connection), { startImmediately: true })
      expect((yield* box.machines.list()).map((machine) => [machine.id, machine.online])).toEqual([
        [box.id, true],
        [gpu.id, false],
      ])
    }),
  ),
)

it.effect("carries messages of many frames intact both ways, one whole message after another", () =>
  home(
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const id = yield* machines.add("gpu")
      const printed = yield* invite(machines, id)
      const tunnel = yield* tunnelled({
        home: printed.home,
        identity: newWorker(),
        secret: printed.secret,
      })
      const files = (yield* machines.get(id)).files
      const large = new Uint8Array(randomBytes(1024 * 1024))
      yield* files.write("/big", large)
      expect((yield* tunnel.files.read("/big")).bytes).toEqual(large)
      expect((yield* files.read("/big")).bytes).toEqual(large)
      // 1 MiB is about 1.4 MB as base64 JSON: at least 21 frames each way.
      const frames = (sent: ReadonlyArray<Uint8Array>) => sent.filter((message) => message.length === 65_535).length
      expect(frames(tunnel.carriers[0].sent.byHome)).toBeGreaterThanOrEqual(21)
      expect(frames(tunnel.carriers[0].sent.byWorker)).toBeGreaterThanOrEqual(21)

      // Many sent in one step, from both sides: each arrives whole and in order.
      const paired = yield* enrol("box")
      const link = yield* linked({ home: paired.home, identity: paired.worker })
      const down = Array.from(
        { length: 8 },
        (_, index): Machine.ToWorker => ({
          type: "fs",
          req: index,
          call: "write",
          path: `/${index}`,
          bytes: new Uint8Array(200_000).fill(index),
        }),
      )
      const up = Array.from(
        { length: 8 },
        (_, index): Extract<Machine.FromWorker, { type: "output" }> => ({
          type: "output",
          id: Machine.ProcessID.make(`${index}`),
          offset: 0,
          data: new Uint8Array(200_000).fill(index),
        }),
      )
      down.forEach(link.served.connection.send)
      up.forEach(link.worker.send)
      expect(yield* collect(Stream.take(link.worker.messages, 8))).toEqual(down)
      expect(yield* collect(Stream.take(link.served.connection.messages, 8))).toEqual(up)
    }),
  ),
)

it.effect("accepts a message of exactly MAX_MESSAGE bytes and ends the link on one byte more", () =>
  home(
    Effect.gen(function* () {
      const json = text(JSON.stringify(Schema.encodeSync(Machine.FromWorker)(started("at-cap"))))
      // JSON allows trailing whitespace, so padding makes a valid message of any length.
      const padded = (length: number) => {
        const bytes = new Uint8Array(length).fill(0x20)
        bytes.set(json)
        return bytes
      }
      const paired = yield* enrol("gpu")
      const atCap = yield* served(paired)
      yield* atCap.worker.pieces(padded(Frames.MAX_MESSAGE))
      yield* atCap.worker.message(started("after"))
      expect(yield* collect(Stream.take(atCap.served.connection.messages, 2))).toEqual([
        started("at-cap"),
        started("after"),
      ])

      const over = yield* served(paired)
      yield* over.worker.pieces(padded(Frames.MAX_MESSAGE + 1))
      yield* over.worker.message(started("after"))
      expect(yield* collect(over.served.connection.messages)).toEqual([])

      // The sending side refuses it before writing a frame.
      const carrier = yield* wires()
      const cipher = { encrypt: (plaintext: Uint8Array) => Result.succeed(plaintext) }
      expect(yield* Frames.write(carrier.home, cipher, new Uint8Array(Frames.MAX_MESSAGE + 1)).pipe(Effect.flip)).toBe(
        "TooLong",
      )
      expect(carrier.sent.byHome).toEqual([])
    }),
  ),
)

it.effect("ends the link on any bad frame or message and delivers nothing after it", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrol("gpu")
      const encoded = (message: unknown) => text(JSON.stringify(message))
      const cases: ReadonlyArray<Uint8Array> = [
        concat(Uint8Array.of(2), encoded(Schema.encodeSync(Machine.FromWorker)(started("b")))),
        Uint8Array.of(1),
        new Uint8Array(0),
        concat(Uint8Array.of(0), text("{not json")),
        concat(Uint8Array.of(0), Uint8Array.of(0xff, 0xfe)),
        concat(Uint8Array.of(0), encoded({ type: "started", id: "b" })),
        concat(Uint8Array.of(0), encoded({ type: "nope" })),
        concat(Uint8Array.of(0), encoded(Schema.encodeSync(Machine.Hello)(HELLO))),
      ]
      for (const bad of cases) {
        const link = yield* served(paired)
        yield* link.worker.message(started("a"))
        yield* link.worker.frame(bad)
        yield* link.worker.message(started("c"))
        expect(yield* collect(link.served.connection.messages)).toEqual([started("a")])
      }

      // On the carrier: the frame after "a" flipped, dropped, or replaced by "a" again. The handshake is two messages
      // and the hello one, so "a" is index 3 and the next frame index 4.
      const tampers: ReadonlyArray<() => Tamper> = [
        () => (message, index) => (index === 4 ? flip(message, 160) : message),
        () => (message, index) => (index === 4 ? undefined : message),
        () => {
          const seen: Uint8Array[] = []
          return (message, index) => {
            seen.push(message)
            return index === 4 ? seen[3] : message
          }
        },
      ]
      for (const tamper of tampers) {
        const link = yield* served(paired, { toHome: tamper() })
        for (const id of ["a", "b", "c"]) yield* link.worker.message(started(id))
        expect(yield* collect(link.served.connection.messages)).toEqual([started("a")])
      }

      // The worker's side ends the same way on a flipped bit from the home: message 2 and the welcome, then "a".
      const flipped = yield* linked(
        { home: paired.home, identity: paired.worker },
        { wires: yield* wires({ toWorker: (message, index) => (index === 3 ? flip(message, 0) : message) }) },
      )
      for (const id of ["a", "b", "c"]) flipped.served.connection.send(release(id))
      expect(yield* collect(flipped.worker.messages)).toEqual([release("a")])
    }),
  ),
)

it.effect("refuses a worker whose first message is not a hello", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrol("gpu")
      const carrier = yield* wires()
      const serving = yield* Effect.forkChild(Link.serve(carrier.home), { startImmediately: true })
      const worker = yield* raw(carrier, { home: paired.home, identity: paired.worker })
      yield* worker.message(started("a"))
      expect(yield* Fiber.join(serving).pipe(Effect.flip)).toEqual(new Link.Refused())
    }),
  ),
)

it.effect("refuses a hello with no protocol version or one it does not know", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrol("gpu")
      const { protocol: _, ...unversioned } = Schema.encodeSync(Machine.Hello)(HELLO)
      for (const hello of [unversioned, { ...unversioned, protocol: 2 }]) {
        const carrier = yield* wires()
        const serving = yield* Effect.forkChild(Link.serve(carrier.home), { startImmediately: true })
        const worker = yield* raw(carrier, { home: paired.home, identity: paired.worker })
        yield* worker.frame(concat(Uint8Array.of(0), text(JSON.stringify(hello))))
        expect(yield* Fiber.join(serving).pipe(Effect.flip)).toEqual(new Link.Refused())
      }
    }),
  ),
)

it.effect("refuses a worker with no hello ten seconds after the carrier arrived, handshake included", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrol("gpu")
      const carrier = yield* wires()
      const serving = yield* Effect.forkChild(Link.serve(carrier.home), { startImmediately: true })
      yield* TestClock.adjust("6 seconds")
      yield* raw(carrier, { home: paired.home, identity: paired.worker })
      yield* TestClock.adjust("3999 millis")
      expect(serving.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 millis")
      expect(yield* Fiber.join(serving).pipe(Effect.flip)).toEqual(new Link.Refused())
    }),
  ),
)

it.effect("rekeys each direction every interval without a message, and a side that rekeys on another count fails", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrol("gpu")
      const options = { home: paired.home, identity: paired.worker }
      // The welcome and the hello are each direction's first message, so 20 more cross six rekeys either way.
      const down = Array.from({ length: 20 }, (_, index) => release(`${index}`))
      const up = Array.from({ length: 20 }, (_, index) => started(`${index}`))
      const link = yield* linked({ ...options, rekeyInterval: 3 }, { fixed: { rekeyInterval: 3 } })
      down.forEach(link.served.connection.send)
      up.forEach(link.worker.send)
      expect(yield* collect(Stream.take(link.worker.messages, 20))).toEqual(down)
      expect(yield* collect(Stream.take(link.served.connection.messages, 20))).toEqual(up)

      // The home rekeys after its 3rd message and the worker after its 4th, so each direction's 4th message is the first
      // lost. One link per direction, so the end of one cannot cut the other short.
      const skewedDown = yield* linked({ ...options, rekeyInterval: 4 }, { fixed: { rekeyInterval: 3 } })
      down.forEach(skewedDown.served.connection.send)
      expect(yield* collect(skewedDown.worker.messages)).toEqual(down.slice(0, 2))
      const skewedUp = yield* linked({ ...options, rekeyInterval: 4 }, { fixed: { rekeyInterval: 3 } })
      up.forEach(skewedUp.worker.send)
      expect(yield* collect(skewedUp.served.connection.messages)).toEqual(up.slice(0, 2))
    }),
  ),
)

it.effect("ends the link with its carrier or its scope, leaving no read waiting and dropping later sends", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrol("gpu")
      const options = { home: paired.home, identity: paired.worker }

      const hungUp = yield* linked(options)
      yield* hungUp.carrier.hangUp
      expect(yield* collect(hungUp.served.connection.messages)).toEqual([])
      expect(yield* collect(hungUp.worker.messages)).toEqual([])
      const before = [hungUp.carrier.sent.byHome.length, hungUp.carrier.sent.byWorker.length]
      hungUp.served.connection.send(release("late"))
      hungUp.worker.send(started("late"))
      yield* Effect.yieldNow
      expect([hungUp.carrier.sent.byHome.length, hungUp.carrier.sent.byWorker.length]).toEqual(before)
      expect(hungUp.carrier.reads.waiting).toBe(0)

      const scope = yield* Scope.make()
      const closed = yield* linked(options).pipe(Scope.provide(scope))
      const homeReading = yield* Effect.forkChild(collect(closed.served.connection.messages), {
        startImmediately: true,
      })
      const workerReading = yield* Effect.forkChild(collect(closed.worker.messages), { startImmediately: true })
      yield* Effect.yieldNow
      expect(closed.carrier.reads.waiting).toBe(2)
      yield* Scope.close(scope, Exit.void)
      expect(yield* Fiber.join(homeReading)).toEqual([])
      expect(yield* Fiber.join(workerReading)).toEqual([])
      expect(closed.carrier.reads.waiting).toBe(0)
      const sent = [closed.carrier.sent.byHome.length, closed.carrier.sent.byWorker.length]
      closed.served.connection.send(release("late"))
      closed.worker.send(started("late"))
      yield* Effect.yieldNow
      expect([closed.carrier.sent.byHome.length, closed.carrier.sent.byWorker.length]).toEqual(sent)
    }),
  ),
)

it.effect("sends a message as full more pieces and one final piece of any length, and refuses a short more", () =>
  Effect.gen(function* () {
    for (const [length, tags] of [
      [0, [0]],
      [PIECE - 1, [0]],
      [PIECE, [0]],
      [PIECE + 1, [1, 0]],
      [2 * PIECE, [1, 0]],
    ] as const) {
      const carrier = yield* wires()
      const message = new Uint8Array(randomBytes(length))
      yield* Frames.write(carrier.home, plain.send, message)
      expect(carrier.sent.byHome.map((frame) => frame[0])).toEqual([...tags])
      expect(yield* Frames.read(carrier.worker, plain.receive)).toEqual(message)
    }
    const carrier = yield* wires()
    yield* carrier.home.send(concat(Uint8Array.of(1), new Uint8Array(PIECE - 1)))
    yield* carrier.home.send(final("rest"))
    expect(yield* Frames.read(carrier.worker, plain.receive).pipe(Effect.flip)).toBe("BadFrame")
  }),
)

it.effect("ends the link when its scope closes before the writer has run", () =>
  Effect.gen(function* () {
    const carrier = yield* wires()
    const scope = yield* Scope.make()
    const link = yield* Frames.open(carrier.home, plain, strings).pipe(Scope.provide(scope))
    yield* Scope.close(scope, Exit.void)
    expect(yield* withinASecond(collect(link.messages))).toEqual(Option.some([]))
    expect(carrier.reads.waiting).toBe(0)
  }),
)

it.effect("delivers nothing more once the link has ended, even a frame already waiting", () =>
  Effect.gen(function* () {
    // The writer fails to encode before anything is read.
    const unencodable = yield* wires()
    const failing = yield* Frames.open(unencodable.home, plain, {
      ...strings,
      encode: () => Effect.fail("unencodable"),
    })
    failing.send("anything")
    yield* Effect.yieldNow
    yield* unencodable.worker.send(final("waiting"))
    expect(yield* collect(failing.messages)).toEqual([])

    // The scope closes once the writer has started.
    const carrier = yield* wires()
    const scope = yield* Scope.make()
    const closed = yield* Frames.open(carrier.home, plain, strings).pipe(Scope.provide(scope))
    yield* Effect.yieldNow
    yield* carrier.worker.send(final("waiting"))
    yield* Scope.close(scope, Exit.void)
    expect(yield* collect(closed.messages)).toEqual([])
  }),
)

it.effect("ends the link on a defect in the read, stopping the writer", () =>
  Effect.gen(function* () {
    const carrier = yield* wires()
    const link = yield* Frames.open({ ...carrier.home, receive: Effect.die(new Error("receive died")) }, plain, strings)
    const exit = yield* Effect.exit(collect(link.messages))
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    link.send("after")
    yield* Effect.yieldNow
    expect(carrier.sent.byHome).toEqual([])
  }),
)

it.effect("keeps a message whole when a rekey falls between its frames, in each direction", () =>
  home(
    Effect.gen(function* () {
      const paired = yield* enrol("gpu")
      const link = yield* linked(
        { home: paired.home, identity: paired.worker, rekeyInterval: 3 },
        { fixed: { rekeyInterval: 3 } },
      )
      // 150 kB is four frames as base64 JSON. Each direction's first message (the welcome, the hello) is message 1, so
      // these are messages 2 to 5 and the rekey after message 3 falls between their 2nd and 3rd frames.
      const down: Machine.ToWorker = { type: "fs", req: 1, call: "write", path: "/big", bytes: randomBytes(150_000) }
      const up: Extract<Machine.FromWorker, { type: "output" }> = {
        type: "output",
        id: Machine.ProcessID.make("p"),
        offset: 0,
        data: randomBytes(150_000),
      }
      link.served.connection.send(down)
      link.served.connection.send(release("next"))
      link.worker.send(up)
      link.worker.send(started("next"))
      expect(yield* collect(Stream.take(link.worker.messages, 2))).toEqual([down, release("next")])
      expect(yield* collect(Stream.take(link.served.connection.messages, 2))).toEqual([up, started("next")])
      // Past the handshake and the first message: four frames, then one.
      expect(link.carrier.sent.byHome.slice(2).map((frame) => frame.length === 65_535)).toEqual([
        true,
        true,
        true,
        false,
        false,
      ])
      expect(link.carrier.sent.byWorker.slice(3).map((frame) => frame.length === 65_535)).toEqual([
        true,
        true,
        true,
        false,
        false,
      ])
    }),
  ),
)

// The transcript the Rust worker must reproduce byte for byte. It was generated once by running both sides of link.ts
// with the inputs in the fixture, which fix every key, the secret and the messages (Ed25519 signatures are
// deterministic), and recording each message on the carrier: the handshake and the welcome, then the worker's hello
// and one message each way as frames. Regenerate it only for a new protocol version, never to make this test pass.
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
      yield* Effect.scoped(linked({ home: printed.home, identity: worker, secret: printed.secret }))
      const carrier = yield* wires()
      const serving = yield* Effect.forkChild(
        Link.serve(carrier.home, {
          static: ok(Noise.keyPair(hex(inputs.home_static))),
          ephemeral: ok(Noise.keyPair(hex(inputs.home_ephemeral))),
        }),
        { startImmediately: true },
      )
      const dialed = yield* Link.connect(carrier.worker, {
        home: printed.home,
        identity: worker,
        secret: hex(inputs.secret),
        static: ok(Noise.keyPair(hex(inputs.worker_static))),
        ephemeral: ok(Noise.keyPair(hex(inputs.worker_ephemeral))),
      })
      // Each message is the fixture's JSON exactly, so the frames carry those bytes.
      const fromWorker = Schema.fromJsonString(Machine.FromWorker)
      const toWorker = Schema.fromJsonString(Machine.ToWorker)
      const [hello, toHome] = [inputs.hello, inputs.to_home].map((json) => Schema.decodeUnknownSync(fromWorker)(json))
      const down = Schema.decodeUnknownSync(toWorker)(inputs.to_worker)
      expect([hello, toHome].map((message) => Schema.encodeSync(fromWorker)(message))).toEqual([
        inputs.hello,
        inputs.to_home,
      ])
      expect(Schema.encodeSync(toWorker)(down)).toBe(inputs.to_worker)
      dialed.send(hello)
      const link = yield* Fiber.join(serving)
      link.connection.send(down)
      expect(yield* collect(Stream.take(dialed.messages, 1))).toEqual([down])
      dialed.send(toHome)
      const received = yield* collect(Stream.take(link.connection.messages, 1))
      expect(received.map((message) => Schema.encodeSync(fromWorker)(message))).toEqual([inputs.to_home])
      expect(dialed.machine).toBe(inputs.machine)
      expect({
        home_identity: toHex(yield* identity.publicKey()),
        worker_identity: toHex(worker.publicKey),
        message_1: toHex(carrier.sent.byWorker[0]),
        message_2: toHex(carrier.sent.byHome[0]),
        message_3: toHex(carrier.sent.byWorker[1]),
        welcome: toHex(carrier.sent.byHome[1]),
        hello: toHex(carrier.sent.byWorker[2]),
        to_worker: toHex(carrier.sent.byHome[2]),
        to_home: toHex(carrier.sent.byWorker[3]),
      }).toEqual(transcript.outputs)
    }),
    hex(inputs.home_seed),
  )
})
