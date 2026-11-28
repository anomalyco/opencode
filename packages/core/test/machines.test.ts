import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Environment } from "@opencode/core/environment/index"
import { Identity } from "@opencode/core/machine/identity"
import { Join } from "@opencode/core/machine/join"
import { Machine } from "@opencode/core/machine/index"
import { Machines } from "@opencode/core/machine/machines"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { MachineTable } from "@opencode/core/machine/sql"
import { eq } from "drizzle-orm"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { Cause, Context, Deferred, Effect, Fiber, Layer, Option, PlatformError, Queue, Scheduler, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { TestClock } from "effect/testing"
import { makePeers, makeWorker, type Peers } from "./fixture/machine-worker"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it, testEffect } from "./lib/effect"

const machineID = (name: string) => Environment.ID.make(name)
const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)
const cause = (error: PlatformError.PlatformError) => error.reason.cause

const dial = (machines: Machines.Interface, id: Environment.ID) =>
  makeWorker({ connect: (connection) => machines.connect(id, connection) })

const connection = (os: string, arch: string) =>
  Effect.map(Queue.unbounded<Exclude<Machine.FromWorker, Machine.Hello>, Cause.Done>(), (queue) => ({
    hello: {
      type: "hello" as const,
      protocol: 3 as const,
      os,
      arch,
      home: "/home/worker",
      instance: Machine.Instance.make(crypto.randomUUID()),
      processes: [],
    },
    send: () => {},
    messages: Stream.fromQueue(queue),
  }))

const tempGlobal = (directory: string) =>
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

const buildLayers = (directory: string, replacements: LayerNode.Replacements) =>
  AppNodeBuilder.build(LayerNode.group([Database.node, Machines.node, Identity.node]), [
    tempGlobal(directory),
    ...replacements,
  ])

const tempLayers = (directory: string) =>
  buildLayers(directory, [Database.node.replace(Database.configured({ path: path.join(directory, "opencode.db") }))])

// Holds the first write of a `join` or the delete of a `remove` so a test can interleave another call while it waits.
const holdBuilder = <T extends object>(
  builder: T,
  gate: Deferred.Deferred<void>,
  entered: Deferred.Deferred<void>,
): T =>
  new Proxy(builder, {
    get(target, property) {
      const value = (target as unknown as Record<PropertyKey, unknown>)[property]
      if (typeof value !== "function") return value
      const call = value as (...args: unknown[]) => unknown
      if (property === "get" || property === "run")
        return (...args: unknown[]) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.andThen(call.apply(target, args) as Effect.Effect<unknown>),
          )
      return (...args: unknown[]) => holdBuilder(call.apply(target, args) as object, gate, entered)
    },
  })

const holdWrites = (db: Database.Interface["db"], gate: Deferred.Deferred<void>, entered: Deferred.Deferred<void>) =>
  new Proxy(db, {
    get(target, property) {
      const value = (target as unknown as Record<PropertyKey, unknown>)[property]
      if (typeof value !== "function") return value
      const call = value as (...args: unknown[]) => unknown
      // KV writes pass through: a join spends its join string before it reaches the machine table.
      if (property === "update" || property === "delete")
        return (...args: unknown[]) =>
          args[0] === MachineTable
            ? holdBuilder(call.apply(target, args) as object, gate, entered)
            : call.apply(target, args)
      return call.bind(target)
    },
  })

const gatedDatabase = (directory: string, gate: Deferred.Deferred<void>, entered: Deferred.Deferred<void>) =>
  Layer.effect(
    Database.Service,
    Effect.gen(function* () {
      const real = yield* Database.Service
      return Database.Service.of({ db: holdWrites(real.db, gate, entered) })
    }),
  ).pipe(
    Layer.provide(
      Database.layer({ path: path.join(directory, "opencode.db") }).pipe(
        Layer.provide(Layer.succeed(Global.Service, Global.make({ data: directory, state: directory }))),
      ),
    ),
  )

const gatedIdentity = (key: Uint8Array, gate: Deferred.Deferred<void>, entered: Deferred.Deferred<void>) => {
  let calls = 0
  return Layer.succeed(Identity.Service, {
    // The first invite loads the key as usual; the second parks between its yields and its checks.
    publicKey: () =>
      Effect.suspend(() => {
        calls++
        if (calls < 2) return Effect.succeed(key)
        return Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.andThen(Effect.succeed(key)),
        )
      }),
    sign: () => Effect.die("unused"),
    seed: () => Effect.die("unused"),
  })
}

const service = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Machines.node])))

service.effect("lists an added machine and gives its environment while it is offline", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    expect(id).toBe(machineID("gpu"))
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false, paired: false })])
    expect((yield* machines.get(id)).id).toBe(id)
  }),
)

service.effect("makes a known machine online with its hello and serves its files", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const worker = yield* dial(machines, id)
    yield* worker.restore
    expect(yield* machines.list()).toEqual([
      new Machines.Info({ id, online: true, paired: false, os: "linux", arch: "x64" }),
    ])
    const environment = yield* machines.get(id)
    yield* environment.files.write("/work/note.txt", bytes("hello"))
    expect(text((yield* environment.files.read("/work/note.txt")).bytes)).toBe("hello")
  }),
)

service.effect("takes a machine offline when its connection is lost", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const worker = yield* dial(machines, id)
    yield* worker.restore
    expect((yield* machines.list())[0]?.online).toBe(true)
    yield* worker.cut
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false, paired: false })])
  }),
)

service.effect("gives a machine's home only while its worker is connected", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    expect(yield* machines.home(id).pipe(Effect.flip)).toBeInstanceOf(Machine.NotSent)
    const worker = yield* dial(machines, id)
    yield* worker.restore
    expect(yield* machines.home(id)).toBe("/home/worker")
    yield* worker.cut
    expect(yield* machines.home(id).pipe(Effect.flip)).toBeInstanceOf(Machine.NotSent)
    expect(yield* machines.home(machineID("ghost")).pipe(Effect.flip)).toBeInstanceOf(Machines.NotFound)
  }),
)

service.effect("serves the newer of two connections and keeps it when the first one ends", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const first = yield* Effect.forkChild(machines.connect(id, yield* connection("darwin", "arm64")), {
      startImmediately: true,
    })
    expect(yield* machines.list()).toEqual([
      new Machines.Info({ id, online: true, paired: false, os: "darwin", arch: "arm64" }),
    ])
    const second = yield* Effect.forkChild(machines.connect(id, yield* connection("linux", "x64")), {
      startImmediately: true,
    })
    expect(yield* machines.list()).toEqual([
      new Machines.Info({ id, online: true, paired: false, os: "linux", arch: "x64" }),
    ])
    yield* Fiber.interrupt(first)
    expect(yield* machines.list()).toEqual([
      new Machines.Info({ id, online: true, paired: false, os: "linux", arch: "x64" }),
    ])
    yield* Fiber.interrupt(second)
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false, paired: false })])
  }),
)

service.effect("refuses a connection for a machine it does not know and serves nothing", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const sent: Machine.ToWorker[] = []
    const error = yield* machines
      .connect(machineID("ghost"), {
        hello: {
          type: "hello",
          protocol: 3,
          os: "linux",
          arch: "x64",
          home: "/home/ghost",
          instance: Machine.Instance.make("ghost"),
          processes: [],
        },
        send: (message) => sent.push(message),
        messages: Stream.fromQueue(yield* Queue.unbounded<Exclude<Machine.FromWorker, Machine.Hello>, Cause.Done>()),
      })
      .pipe(Effect.flip)
    expect(error).toBeInstanceOf(Machines.NotFound)
    expect(error.message).toBe('No machine named "ghost".')
    expect(sent).toEqual([])
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false, paired: false })])
  }),
)

service.effect("keeps a second machine online and usable when the first goes away", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const gpu = yield* machines.add("gpu")
    const box = yield* machines.add("box")
    const first = yield* dial(machines, gpu)
    const second = yield* dial(machines, box)
    yield* first.restore
    yield* second.restore
    const environment = yield* machines.get(box)
    yield* environment.files.write("/work/box.txt", bytes("box"))
    expect(yield* machines.list()).toEqual([
      new Machines.Info({ id: box, online: true, paired: false, os: "linux", arch: "x64" }),
      new Machines.Info({ id: gpu, online: true, paired: false, os: "linux", arch: "x64" }),
    ])
    yield* first.cut
    expect((yield* machines.list()).map((machine) => [machine.id, machine.online])).toEqual([
      [box, true],
      [gpu, false],
    ])
    expect(text((yield* environment.files.read("/work/box.txt")).bytes)).toBe("box")
    expect(yield* (yield* machines.get(gpu)).files.stat("/work").pipe(Effect.flip)).toMatchObject({
      cause: expect.any(Machine.NotSent),
    })
  }),
)

service.effect("removing a connected machine ends its connection and forgets it", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const environment = yield* machines.get(id)
    const worker = yield* dial(machines, id)
    yield* worker.restore
    worker.drop("home", "fs")
    const waiting = yield* Effect.forkChild(environment.files.stat("/work"), { startImmediately: true })
    yield* machines.remove(id)
    const lost = yield* Fiber.join(waiting).pipe(Effect.flip)
    expect(lost._tag === "Environment.Failed" && lost.cause).toBeInstanceOf(Machine.Unknown)
    const later = yield* environment.files.stat("/work").pipe(Effect.flip)
    expect(later._tag === "Environment.Failed" && later.cause).toBeInstanceOf(Machine.NotSent)
    expect(yield* machines.get(id).pipe(Effect.flip)).toBeInstanceOf(Machines.NotFound)
    expect(yield* machines.list()).toEqual([])
    yield* worker.cut
  }),
)

service.effect("removing a machine fails a running process at once", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const environment = yield* machines.get(id)
    const worker = yield* dial(machines, id)
    yield* worker.restore
    const handle = yield* environment.spawner.spawn(ChildProcess.make("/bin/sh", ["-c", "make"], { cwd: "/work" }))
    yield* worker.runs[0].print("partial")
    yield* machines.remove(id)
    const exit = yield* handle.exitCode.pipe(Effect.flip)
    expect(cause(exit)).toBeInstanceOf(Machines.NotFound)
    expect(String(cause(exit))).toContain('No machine named "gpu".')
    const output = yield* Stream.runDrain(handle.all).pipe(Effect.flip)
    expect(cause(output)).toBeInstanceOf(Machines.NotFound)
    yield* handle.kill()
  }),
)

service.effect("refuses a bad name and a name it already knows", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    for (const name of ["", "x", "Gpu", "9gpu", "gpu_1", "local", "g".repeat(64)]) {
      expect(yield* machines.add(name).pipe(Effect.flip)).toBeInstanceOf(Machines.InvalidName)
    }
    const id = yield* machines.add("gpu-2")
    expect(yield* machines.add("gpu-2").pipe(Effect.flip)).toBeInstanceOf(Machines.AlreadyExists)
    const longest = yield* machines.add("g".repeat(63))
    expect(yield* machines.list()).toEqual([
      new Machines.Info({ id: longest, online: false, paired: false }),
      new Machines.Info({ id, online: false, paired: false }),
    ])
  }),
)

it.effect("keeps known machines across a service rebuild and keeps live state in memory only", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const layers = tempLayers(tmp.path)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const worker = yield* dial(machines, id)
        yield* worker.restore
        expect((yield* machines.list())[0]?.online).toBe(true)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
    yield* Effect.gen(function* () {
      const machines = yield* Machines.Service
      const id = machineID("gpu")
      expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false, paired: false })])
      expect((yield* machines.get(id)).id).toBe(id)
    }).pipe(Effect.provide(layers, { local: true }))
  }),
)

it.effect("reports a machine another process added to the same database", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = Context.get(yield* Layer.build(tempLayers(tmp.path)), Machines.Service)
        // The second process loaded the empty table before the first one added the machine.
        const second = Context.get(yield* Layer.build(tempLayers(tmp.path)), Machines.Service)
        const id = yield* first.add("gpu")
        expect(yield* second.add("gpu").pipe(Effect.flip)).toBeInstanceOf(Machines.AlreadyExists)
        expect(yield* second.list()).toEqual([new Machines.Info({ id, online: false, paired: false })])
        expect((yield* second.get(id)).id).toBe(id)
      }),
    )
  }),
)

const invite = (machines: Machines.Interface, id: Environment.ID, replace = false) =>
  machines
    .invite(id, { reach: [{ type: "url", url: "https://home.example" }], replace })
    .pipe(Effect.map((text) => Option.getOrThrow(Join.decode(text))))

it.effect("pairs a machine from a printed join string and identifies it after a rebuild", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const layers = tempLayers(tmp.path)
    const key = new Uint8Array(32).fill(9)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const printed = yield* invite(machines, id)
        expect(printed.home).toEqual(yield* (yield* Identity.Service).publicKey())
        expect(printed.reach).toEqual([{ type: "url", url: "https://home.example" }])
        expect(yield* machines.join({ secret: printed.secret, key })).toBe(id)
        expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false, paired: true })])
        expect(yield* machines.identify(key)).toBe(id)
        const worker = yield* dial(machines, id)
        yield* worker.restore
        expect(yield* machines.list()).toEqual([
          new Machines.Info({ id, online: true, paired: true, os: "linux", arch: "x64" }),
        ])
        yield* worker.cut
      }),
    ).pipe(Effect.provide(layers, { local: true }))
    yield* Effect.gen(function* () {
      const machines = yield* Machines.Service
      expect(yield* machines.identify(key)).toBe(machineID("gpu"))
      expect((yield* machines.list())[0]?.paired).toBe(true)
    }).pipe(Effect.provide(layers, { local: true }))
  }),
)

it.effect("honours a join string printed before the service was rebuilt and spends it once", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const layers = tempLayers(tmp.path)
    const key = new Uint8Array(32).fill(9)
    const printed = yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        return yield* invite(machines, id)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
    // A cold service, as after a Durable Object eviction, still honours the string the old one printed.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        expect(yield* machines.join({ secret: printed.secret, key })).toBe(machineID("gpu"))
        expect(
          yield* machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(7) }).pipe(Effect.flip),
        ).toBeInstanceOf(Machines.InvalidJoin)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
    // Spent on the KV side too: a third service cannot redeem it again.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        expect(yield* machines.identify(key)).toBe(machineID("gpu"))
        expect(
          yield* machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(7) }).pipe(Effect.flip),
        ).toBeInstanceOf(Machines.InvalidJoin)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
  }),
)

it.effect("clears a stored join string when its machine is removed", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const layers = tempLayers(tmp.path)
    const printed = yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const printed = yield* invite(machines, id)
        yield* machines.remove(id)
        return printed
      }),
    ).pipe(Effect.provide(layers, { local: true }))
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        yield* machines.add("gpu")
        expect(
          yield* machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(9) }).pipe(Effect.flip),
        ).toBeInstanceOf(Machines.InvalidJoin)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
  }),
)

it.effect("refuses a stored join string that expired while the service was away", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const layers = tempLayers(tmp.path)
    const printed = yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const printed = yield* invite(machines, id)
        yield* TestClock.adjust("6 minutes")
        return printed
      }),
    ).pipe(Effect.provide(layers, { local: true }))
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        expect(
          yield* machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(9) }).pipe(Effect.flip),
        ).toBeInstanceOf(Machines.InvalidJoin)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
  }),
)

it.effect("spends a join secret once, expires it and refuses a stranger, all as one error", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const key = new Uint8Array(32).fill(9)
        const printed = yield* invite(machines, id)
        const stranger = yield* machines.join({ secret: new Uint8Array(32).fill(8), key }).pipe(Effect.flip)
        yield* machines.join({ secret: printed.secret, key })
        const again = yield* machines.join({ secret: printed.secret, key }).pipe(Effect.flip)
        // The stranger's try did not spend the real secret above, which joined once.
        expect(stranger).toBeInstanceOf(Machines.InvalidJoin)
        expect(again).toBeInstanceOf(Machines.InvalidJoin)
        expect(again.message).toBe(stranger.message)

        const late = yield* invite(machines, id, true)
        yield* TestClock.adjust("6 minutes")
        const expired = yield* machines.join({ secret: late.secret, key }).pipe(Effect.flip)
        expect(expired).toBeInstanceOf(Machines.InvalidJoin)
        expect(expired.message).toBe(stranger.message)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("invalidates the older join string when a machine is invited again", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const key = new Uint8Array(32).fill(9)
        const first = yield* invite(machines, id)
        const second = yield* invite(machines, id)
        expect(yield* machines.join({ secret: first.secret, key }).pipe(Effect.flip)).toBeInstanceOf(
          Machines.InvalidJoin,
        )
        expect(yield* machines.join({ secret: second.secret, key })).toBe(id)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("replaces a paired machine's key only when asked, and the old key stops identifying it", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const old = new Uint8Array(32).fill(9)
        const next = new Uint8Array(32).fill(7)
        yield* machines.join({ secret: (yield* invite(machines, id)).secret, key: old })
        expect(yield* invite(machines, id).pipe(Effect.flip)).toBeInstanceOf(Machines.AlreadyPaired)
        yield* machines.join({ secret: (yield* invite(machines, id, true)).secret, key: next })
        expect(yield* machines.identify(old).pipe(Effect.flip)).toBeInstanceOf(Machines.UnknownKey)
        expect(yield* machines.identify(next)).toBe(id)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("refuses a key another machine already wears and spends the refused secret", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const gpu = yield* machines.add("gpu")
        const box = yield* machines.add("box")
        const key = new Uint8Array(32).fill(9)
        yield* machines.join({ secret: (yield* invite(machines, gpu)).secret, key })
        const printed = yield* invite(machines, box)
        expect(yield* machines.join({ secret: printed.secret, key }).pipe(Effect.flip)).toBeInstanceOf(
          Machines.InvalidJoin,
        )
        expect(
          yield* machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(7) }).pipe(Effect.flip),
        ).toBeInstanceOf(Machines.InvalidJoin)
        expect(yield* machines.identify(key)).toBe(gpu)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("refuses a key that is not 32 bytes without spending the secret", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const gpu = yield* machines.add("gpu")
        const printed = yield* invite(machines, gpu)
        for (const key of [new Uint8Array(), new Uint8Array(31).fill(9), new Uint8Array(33).fill(9)])
          expect(yield* machines.join({ secret: printed.secret, key }).pipe(Effect.flip)).toBeInstanceOf(
            Machines.InvalidJoin,
          )
        expect(yield* machines.identify(new Uint8Array()).pipe(Effect.flip)).toBeInstanceOf(Machines.UnknownKey)
        expect(yield* machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(9) })).toBe(gpu)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("drops a pending join string when the machine is removed and refuses work for a stranger", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const printed = yield* invite(machines, id)
        yield* machines.remove(id)
        // A fresh machine of the same name would accept the old secret if removal had left it pending.
        yield* machines.add("gpu")
        expect(
          yield* machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(9) }).pipe(Effect.flip),
        ).toBeInstanceOf(Machines.InvalidJoin)
        expect(yield* invite(machines, machineID("ghost")).pipe(Effect.flip)).toBeInstanceOf(Machines.NotFound)
        expect(yield* machines.identify(new Uint8Array(32).fill(9)).pipe(Effect.flip)).toBeInstanceOf(
          Machines.UnknownKey,
        )
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("refuses an invite whose machine is paired while it loads the home key", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const gate = yield* Deferred.make<void>()
    const entered = yield* Deferred.make<void>()
    const layers = buildLayers(tmp.path, [
      Database.node.replace(Database.configured({ path: path.join(tmp.path, "opencode.db") })),
      Identity.node.replace(gatedIdentity(new Uint8Array(32).fill(5), gate, entered)),
    ])
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const first = yield* invite(machines, id)
        const pending = yield* Effect.forkChild(
          machines.invite(id, { reach: [{ type: "url", url: "https://home.example" }] }),
          {
            startImmediately: true,
          },
        )
        yield* Deferred.await(entered)
        const key = new Uint8Array(32).fill(9)
        yield* machines.join({ secret: first.secret, key })
        yield* Deferred.succeed(gate, undefined)
        const late = yield* Fiber.join(pending).pipe(Effect.exit)
        expect(late._tag === "Failure" && Cause.squash(late.cause)).toBeInstanceOf(Machines.AlreadyPaired)
        expect(yield* machines.identify(key)).toBe(id)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
  }),
)

it.effect("never pairs two joins when the name is invited again mid-join", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const gate = yield* Deferred.make<void>()
    const entered = yield* Deferred.make<void>()
    const layers = buildLayers(tmp.path, [Database.node.replace(gatedDatabase(tmp.path, gate, entered))])
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const first = yield* invite(machines, id)
        const oldKey = new Uint8Array(32).fill(9)
        const joining = yield* Effect.forkChild(machines.join({ secret: first.secret, key: oldKey }), {
          startImmediately: true,
        })
        yield* Deferred.await(entered)
        const second = yield* invite(machines, id)
        const newKey = new Uint8Array(32).fill(7)
        const later = yield* Effect.forkChild(machines.join({ secret: second.secret, key: newKey }), {
          startImmediately: true,
        })
        yield* Deferred.succeed(gate, undefined)
        expect(yield* Fiber.join(joining)).toBe(id)
        const late = yield* Fiber.join(later).pipe(Effect.exit)
        expect(late._tag === "Failure" && Cause.squash(late.cause)).toBeInstanceOf(Machines.InvalidJoin)
        expect(yield* machines.identify(oldKey)).toBe(id)
        expect(yield* machines.identify(newKey).pipe(Effect.flip)).toBeInstanceOf(Machines.UnknownKey)
      }),
    ).pipe(Effect.provide(layers, { local: true }))
  }),
)

it.effect("fails a join that was in flight when its machine was removed and re-added", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const gate = yield* Deferred.make<void>()
    const entered = yield* Deferred.make<void>()
    const layers = buildLayers(tmp.path, [Database.node.replace(gatedDatabase(tmp.path, gate, entered))])
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const id = yield* machines.add("gpu")
        const printed = yield* invite(machines, id)
        const removing = yield* Effect.forkChild(machines.remove(id), { startImmediately: true })
        yield* Deferred.await(entered)
        const reading = yield* Effect.forkChild(machines.add("gpu"), { startImmediately: true })
        const joining = yield* Effect.forkChild(
          machines.join({ secret: printed.secret, key: new Uint8Array(32).fill(9) }),
          { startImmediately: true },
        )
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(removing)
        expect(yield* Fiber.join(reading)).toBe(id)
        const late = yield* Fiber.join(joining).pipe(Effect.exit)
        expect(late._tag === "Failure" && Cause.squash(late.cause)).toBeInstanceOf(Machines.InvalidJoin)
        expect((yield* machines.list()).map((machine) => machine.paired)).toEqual([false])
      }),
    ).pipe(Effect.provide(layers, { local: true }))
  }),
)

/**
 * Runs `effect` one runtime operation at a time and interrupts it after `steps` of them. Returns false when it finished
 * first, so a caller stepping `steps` up from 0 has interrupted it between every two operations it makes.
 */
const interruptAfter = <A, E>(effect: Effect.Effect<A, E>, steps: number) =>
  Effect.gen(function* () {
    const tasks: Array<() => void> = []
    const scheduler: Scheduler.Scheduler = {
      executionMode: "async",
      // A resumed fiber spends its first operation on the resumption and its second on the work it yielded before, so it
      // yields from its third: one step of real progress per task.
      shouldYield: (fiber) => fiber.currentOpCount > 2,
      makeDispatcher: () => ({
        scheduleTask: (task) => {
          tasks.push(task)
        },
        flush: () => {
          while (tasks.length > 0) tasks.shift()?.()
        },
      }),
    }
    const fiber = yield* Effect.forkChild(effect.pipe(Effect.provideService(Scheduler.Scheduler, scheduler)), {
      startImmediately: true,
    })
    // Every operation these tests interrupt is synchronous (bun:sqlite included), so the fiber is always either done
    // or parked in `tasks`.
    for (let taken = 0; taken < steps && tasks.length > 0; taken++) tasks.shift()?.()
    if (fiber.pollUnsafe()) return false
    fiber.interruptUnsafe()
    while (tasks.length > 0) tasks.shift()?.()
    yield* Fiber.await(fiber)
    return true
  })

/** Whether the machine's row is on disk, and its key, read from the database rather than the service's memory. */
const stored = (id: Environment.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db
      .select({ key: MachineTable.key })
      .from(MachineTable)
      .where(eq(MachineTable.id, id))
      .get()
      .pipe(Effect.orDie)
  })

it.effect("an interrupted join leaves the machine paired on disk and in memory, or its invitation still good", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        let steps = 0
        for (; steps < 10_000; steps++) {
          const id = yield* machines.add(`gpu-${steps}`)
          const printed = yield* invite(machines, id)
          const key = new Uint8Array(randomBytes(32))
          if (!(yield* interruptAfter(machines.join({ secret: printed.secret, key }), steps))) break
          const paired = Option.isSome(yield* machines.identify(key).pipe(Effect.option))
          expect([steps, paired]).toEqual([steps, (yield* stored(id))?.key != null])
          if (!paired) expect(yield* machines.join({ secret: printed.secret, key })).toBe(id)
        }
        expect(steps).toBeGreaterThan(10)
        expect(steps).toBeLessThan(10_000)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("an interrupted remove forgets the machine on disk and in memory, or in neither", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        let steps = 0
        for (; steps < 10_000; steps++) {
          const id = yield* machines.add(`gpu-${steps}`)
          const key = new Uint8Array(randomBytes(32))
          yield* machines.join({ secret: (yield* invite(machines, id)).secret, key })
          if (!(yield* interruptAfter(machines.remove(id), steps))) break
          const known = (yield* machines.list()).some((machine) => machine.id === id)
          const paired = Option.isSome(yield* machines.identify(key).pipe(Effect.option))
          const row = yield* stored(id)
          expect([steps, known, paired]).toEqual([steps, row !== undefined, row !== undefined])
        }
        expect(steps).toBeGreaterThan(10)
        expect(steps).toBeLessThan(10_000)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("an interrupted add knows the machine on disk and in memory, or in neither", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        let steps = 0
        for (; steps < 10_000; steps++) {
          const id = machineID(`gpu-${steps}`)
          if (!(yield* interruptAfter(machines.add(id), steps))) break
          const known = (yield* machines.list()).some((machine) => machine.id === id)
          expect([steps, known]).toEqual([steps, (yield* stored(id)) !== undefined])
        }
        expect(steps).toBeGreaterThan(10)
        expect(steps).toBeLessThan(10_000)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

/** A paired machine whose fake worker reaches the others through `peers`, and that machine's key as the home stores it. */
const pairedPeer = (machines: Machines.Interface, name: string, peers: Peers) =>
  Effect.gen(function* () {
    const id = yield* machines.add(name)
    const invite = yield* machines.invite(id, { reach: [{ type: "url", url: "https://home.example" }] })
    const key = randomBytes(32)
    yield* machines.join({ secret: Option.getOrThrow(Join.decode(invite)).secret, key })
    const worker = yield* makeWorker({ connect: (connection) => machines.connect(id, connection) }, peers)
    yield* worker.restore
    return { id, worker, key: key.toString("base64url"), files: Environment.makeFiles(worker.files) }
  })

it.effect("links two machines once, the sender dialling the receiver's key, keeping the link across reconnects", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const peers = makePeers()
        const gpu = yield* pairedPeer(machines, "gpu", peers)
        const pro = yield* pairedPeer(machines, "pro", peers)
        yield* gpu.files.write("/a", bytes("one"))
        yield* machines.copy({ machine: gpu.id, path: "/a" }, { machine: pro.id, path: "/b" })
        yield* machines.copy({ machine: gpu.id, path: "/a" }, { machine: pro.id, path: "/c" })
        expect(text((yield* pro.files.read("/c")).bytes)).toBe("one")
        const connects = gpu.worker.received.filter((message) => message.type === "peer-connect")
        const accepts = pro.worker.received.filter((message) => message.type === "peer-accept")
        expect(connects).toEqual([expect.objectContaining({ key: pro.key })])
        expect(accepts).toEqual([expect.objectContaining({ key: gpu.key, link: connects[0]?.link })])

        // The link outlives the worker's connection to the home: the next hello lists it, so it is used again.
        yield* pro.worker.restore
        yield* machines.copy({ machine: gpu.id, path: "/a" }, { machine: pro.id, path: "/d" })
        expect(gpu.worker.received.filter((message) => message.type === "peer-connect")).toHaveLength(1)
        // A new worker process has none, so the two are linked again.
        yield* pro.worker.restart
        yield* machines.copy({ machine: gpu.id, path: "/a" }, { machine: pro.id, path: "/e" })
        expect(gpu.worker.received.filter((message) => message.type === "peer-connect")).toHaveLength(2)
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("revokes the receive when the send fails", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const peers = makePeers()
        const gpu = yield* pairedPeer(machines, "gpu", peers)
        const pro = yield* pairedPeer(machines, "pro", peers)
        const error = yield* machines
          .copy({ machine: gpu.id, path: "/missing" }, { machine: pro.id, path: "/b" })
          .pipe(Effect.flip)
        expect(error).toBeInstanceOf(Machine.PeerFailed)
        expect(peers.receives.size).toBe(0)
        expect(pro.worker.received.map((message) => message.type)).toContain("peer-revoke")
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("refuses a peer link to the same machine or to one that never paired", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const gpu = yield* pairedPeer(machines, "gpu", makePeers())
        const pro = yield* machines.add("pro")
        const same = yield* machines
          .copy({ machine: gpu.id, path: "/a" }, { machine: gpu.id, path: "/b" })
          .pipe(Effect.flip)
        expect(same).toMatchObject({ _tag: "Machine.PeerFailed", reason: "both ends are on the same machine" })
        const unpaired = yield* machines
          .forward({ machine: gpu.id, port: 3000 }, { machine: pro, port: 8000 })
          .pipe(Effect.flip)
        expect(unpaired).toMatchObject({ _tag: "Machine.PeerFailed", machine: pro, reason: "not paired" })
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)

it.effect("lets a transfer finish when the sender's answer is lost, without revoking it", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const machines = yield* Machines.Service
        const peers = makePeers()
        const gpu = yield* pairedPeer(machines, "gpu", peers)
        const pro = yield* pairedPeer(machines, "pro", peers)
        yield* gpu.files.write("/a", bytes("one"))
        // Link first, so the next answer gpu gives is the one to its send.
        yield* machines.copy({ machine: gpu.id, path: "/a" }, { machine: pro.id, path: "/b" })
        gpu.worker.drop("home", "peer")
        const copying = yield* Effect.forkChild(
          machines.copy({ machine: gpu.id, path: "/a" }, { machine: pro.id, path: "/c" }),
          { startImmediately: true },
        )
        while (Option.isNone(yield* pro.files.stat("/c").pipe(Effect.option))) yield* Effect.yieldNow
        yield* gpu.worker.cut
        expect(yield* Fiber.join(copying).pipe(Effect.flip)).toBeInstanceOf(Machine.Unknown)
        expect(text((yield* pro.files.read("/c")).bytes)).toBe("one")
        expect(pro.worker.received.map((message) => message.type)).not.toContain("peer-revoke")
      }),
    ).pipe(Effect.provide(tempLayers(tmp.path), { local: true }))
  }),
)
