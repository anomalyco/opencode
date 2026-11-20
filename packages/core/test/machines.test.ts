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
import path from "node:path"
import { Cause, Context, Deferred, Effect, Fiber, Layer, Option, PlatformError, Queue, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { TestClock } from "effect/testing"
import { makeWorker } from "./fixture/machine-worker"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it, testEffect } from "./lib/effect"

const machineID = (name: string) => Environment.ID.make(name)
const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)
const cause = (error: PlatformError.PlatformError) => error.reason.cause

const dial = (machines: Machines.Interface, id: Environment.ID) =>
  makeWorker({ environment: { id }, connect: machines.connect })

const connection = (name: string, os: string, arch: string) =>
  Effect.map(Queue.unbounded<Exclude<Machine.FromWorker, Machine.Hello>, Cause.Done>(), (queue) => ({
    hello: {
      type: "hello" as const,
      name,
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
      if (property === "update" || property === "delete")
        return (...args: unknown[]) => holdBuilder(call.apply(target, args) as object, gate, entered)
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
    const first = yield* Effect.forkChild(machines.connect(yield* connection("gpu", "darwin", "arm64")), {
      startImmediately: true,
    })
    expect(yield* machines.list()).toEqual([
      new Machines.Info({ id, online: true, paired: false, os: "darwin", arch: "arm64" }),
    ])
    const second = yield* Effect.forkChild(machines.connect(yield* connection("gpu", "linux", "x64")), {
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
      .connect({
        hello: {
          type: "hello",
          name: "ghost",
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
    for (const name of ["", "x", "Gpu", "9gpu", "gpu_1", "local"]) {
      expect(yield* machines.add(name).pipe(Effect.flip)).toBeInstanceOf(Machines.InvalidName)
    }
    const id = yield* machines.add("gpu-2")
    expect(yield* machines.add("gpu-2").pipe(Effect.flip)).toBeInstanceOf(Machines.AlreadyExists)
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false, paired: false })])
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
