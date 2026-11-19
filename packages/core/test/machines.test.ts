import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Environment } from "@opencode/core/environment/index"
import { Machine } from "@opencode/core/machine/index"
import { Machines } from "@opencode/core/machine/machines"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import path from "node:path"
import { Cause, Context, Effect, Fiber, Layer, PlatformError, Queue, Stream } from "effect"
import { ChildProcess } from "effect/process"
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
      instance: Machine.Instance.make(crypto.randomUUID()),
      processes: [],
    },
    send: () => {},
    messages: Stream.fromQueue(queue),
  }))

const tempLayers = (directory: string) =>
  AppNodeBuilder.build(LayerNode.group([Database.node, Machines.node]), [
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

const service = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Machines.node])))

service.effect("lists an added machine and gives its environment while it is offline", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    expect(id).toBe(machineID("gpu"))
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false })])
    expect((yield* machines.get(id)).id).toBe(id)
  }),
)

service.effect("makes a known machine online with its hello and serves its files", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const worker = yield* dial(machines, id)
    yield* worker.restore
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: true, os: "linux", arch: "x64" })])
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
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false })])
  }),
)

service.effect("serves the newer of two connections and keeps it when the first one ends", () =>
  Effect.gen(function* () {
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")
    const first = yield* Effect.forkChild(machines.connect(yield* connection("gpu", "darwin", "arm64")), {
      startImmediately: true,
    })
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: true, os: "darwin", arch: "arm64" })])
    const second = yield* Effect.forkChild(machines.connect(yield* connection("gpu", "linux", "x64")), {
      startImmediately: true,
    })
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: true, os: "linux", arch: "x64" })])
    yield* Fiber.interrupt(first)
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: true, os: "linux", arch: "x64" })])
    yield* Fiber.interrupt(second)
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false })])
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
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false })])
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
      new Machines.Info({ id: box, online: true, os: "linux", arch: "x64" }),
      new Machines.Info({ id: gpu, online: true, os: "linux", arch: "x64" }),
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
    expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false })])
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
      expect(yield* machines.list()).toEqual([new Machines.Info({ id, online: false })])
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
        expect(yield* second.list()).toEqual([new Machines.Info({ id, online: false })])
        expect((yield* second.get(id)).id).toBe(id)
      }),
    )
  }),
)
