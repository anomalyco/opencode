import fs from "fs/promises"
import path from "path"
import { expect } from "bun:test"
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { ChildProcessHandle } from "effect/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { Event, type Info } from "@opencode/schema/shell"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"

// Covers the acquisition ownership issue previously addressed by closed, unmerged PR #52386.
// All children are real; Deferred gates control handoff through existing Environment and Bus interfaces.
const shellCommand = {
  shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
  command: process.platform === "win32" ? "Start-Sleep -Seconds 60" : "sleep 60",
  timeout: 0,
}

type Tracked = {
  handle: ChildProcessHandle
  released: Deferred.Deferred<void>
  outputStopped: Deferred.Deferred<void>
  exitStopped: Deferred.Deferred<void>
}

type Fixture = {
  shell: Shell.Interface
  bus: Bus.Interface
  spawned: Deferred.Deferred<Tracked>
  allowSpawnReturn: Deferred.Deferred<void>
  outputRoot: string
}

function withShell<A, E, R>(options: { holdSpawn?: boolean }, body: (fixture: Fixture) => Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const spawned = yield* Deferred.make<Tracked>()
    const allowSpawnReturn = yield* Deferred.make<void>()
    const processes: Tracked[] = []
    const environment = Layer.effect(
      Environment.Service,
      Effect.gen(function* () {
        const host = yield* Environment.Service
        return Environment.Service.of({
          ...host,
          spawner: ChildProcessSpawner.make((command) =>
            Effect.gen(function* () {
              const handle = yield* host.spawner.spawn(command)
              const tracked = {
                handle,
                released: yield* Deferred.make<void>(),
                outputStopped: yield* Deferred.make<void>(),
                exitStopped: yield* Deferred.make<void>(),
              }
              processes.push(tracked)
              yield* Effect.addFinalizer(() => Deferred.succeed(tracked.released, undefined))
              yield* Deferred.succeed(spawned, tracked)
              if (options.holdSpawn) yield* Deferred.await(allowSpawnReturn)
              return {
                ...handle,
                all: handle.all.pipe(Stream.ensuring(Deferred.succeed(tracked.outputStopped, undefined))),
                exitCode: handle.exitCode.pipe(Effect.ensuring(Deferred.succeed(tracked.exitStopped, undefined))),
              }
            }),
          ),
        })
      }),
    ).pipe(Layer.provide(hostEnvironmentLayer))

    return yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      const bus = yield* Bus.Service
      const global = yield* Global.Service
      const location = yield* Location.Service
      return yield* body({
        shell,
        bus,
        spawned,
        allowSpawnReturn,
        outputRoot: path.join(global.data, Shell.DIRECTORY, location.project.id),
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(allowSpawnReturn, undefined).pipe(
            Effect.andThen(
              Effect.forEach(
                processes,
                (tracked) => tracked.handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.ignore),
                { discard: true },
              ),
            ),
          ),
        ),
      )
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Shell.node, Bus.node, Global.node, Location.node]), [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(environment),
        ]),
      ),
    )
  })
}

it.live("cancels acquisition before registration and releases the spawned process", () =>
  withShell({ holdSpawn: true }, (fixture) =>
    Effect.gen(function* () {
      const created = yield* Deferred.make<Info>()
      yield* Effect.acquireRelease(
        fixture.bus.listen((event) =>
          Schema.is(Event.Created)(event)
            ? Deferred.succeed(created, event.data.info).pipe(Effect.asVoid)
            : Effect.void,
        ),
        (unsubscribe) => unsubscribe,
      )
      const acquisition = yield* fixture.shell.create(shellCommand).pipe(Effect.forkScoped({ startImmediately: true }))
      const tracked = yield* Deferred.await(fixture.spawned)
      yield* Fiber.interrupt(acquisition)
      const running = yield* tracked.handle.isRunning
      const released = yield* Deferred.isDone(tracked.released)

      // Also clean the unpatched failure path before reporting its assertion.
      yield* Deferred.succeed(fixture.allowSpawnReturn, undefined)
      if (running) {
        yield* tracked.handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.ignore)
        const info = yield* Deferred.await(created)
        yield* fixture.shell.wait(info.id)
        yield* fixture.shell.remove(info.id)
      }

      expect(running).toBe(false)
      expect(released).toBe(true)
      expect(yield* fixture.shell.list()).toEqual([])
      expect(yield* Effect.promise(() => fs.readdir(fixture.outputRoot))).toEqual([])
    }),
  ),
)

it.live("cancels acquisition after registration before the shell ID is handed off", () =>
  withShell({}, (fixture) =>
    Effect.gen(function* () {
      const created = yield* Deferred.make<Info>()
      const allowCreated = yield* Deferred.make<void>()
      const events: string[] = []
      yield* Effect.acquireRelease(
        fixture.bus.listen((event) => {
          events.push(event.type)
          if (!Schema.is(Event.Created)(event)) return Effect.void
          return Deferred.succeed(created, event.data.info).pipe(Effect.andThen(Deferred.await(allowCreated)))
        }),
        (unsubscribe) => unsubscribe,
      )
      const acquisition = yield* fixture.shell.create(shellCommand).pipe(Effect.forkScoped({ startImmediately: true }))
      const info = yield* Deferred.await(created)
      const tracked = yield* Deferred.await(fixture.spawned)
      yield* Fiber.interrupt(acquisition)
      const running = yield* tracked.handle.isRunning
      const retained = yield* fixture.shell.get(info.id).pipe(Effect.exit)
      const outputExists = yield* Effect.promise(() => Bun.file(info.file).exists())
      const outputStopped = yield* Deferred.isDone(tracked.outputStopped)
      const exitStopped = yield* Deferred.isDone(tracked.exitStopped)

      // Release and reap the old implementation's independent manager before assertions.
      yield* Deferred.succeed(allowCreated, undefined)
      if (running) {
        yield* tracked.handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.ignore)
        yield* fixture.shell.wait(info.id)
        yield* fixture.shell.remove(info.id)
      }

      expect(running).toBe(false)
      expect(Exit.isFailure(retained)).toBe(true)
      expect(outputExists).toBe(false)
      expect(outputStopped).toBe(true)
      expect(exitStopped).toBe(true)
      expect(yield* Deferred.isDone(tracked.released)).toBe(true)
      expect(events.filter((type) => type === "shell.deleted")).toHaveLength(1)
      expect(events.at(-1)).toBe("shell.deleted")
    }),
  ),
)

it.live("a handed-off shell survives its caller's scope and settles after an explicit kill", () =>
  withShell({}, (fixture) =>
    Effect.gen(function* () {
      const caller = yield* Scope.make()
      const info = yield* fixture.shell.create(shellCommand).pipe(Scope.provide(caller))
      const tracked = yield* Deferred.await(fixture.spawned)
      yield* Scope.close(caller, Exit.void)
      expect(info.status).toBe("running")
      expect(yield* tracked.handle.isRunning).toBe(true)
      expect(yield* Deferred.isDone(tracked.released)).toBe(false)

      yield* tracked.handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.ignore)
      expect((yield* fixture.shell.wait(info.id)).status).toBe("exited")
      expect(yield* tracked.handle.isRunning).toBe(false)
      yield* fixture.shell.remove(info.id)
    }),
  ),
)

it.live("a spawn failure creates no shell record or output file", () =>
  withShell({}, (fixture) =>
    Effect.gen(function* () {
      const created: string[] = []
      yield* Effect.acquireRelease(
        fixture.bus.listen((event) => {
          if (Schema.is(Event.Created)(event)) created.push(event.data.info.id)
          return Effect.void
        }),
        (unsubscribe) => unsubscribe,
      )
      const failure = yield* fixture.shell
        .create({ ...shellCommand, cwd: path.join(fixture.outputRoot, "missing-directory") })
        .pipe(Effect.exit)
      expect(Exit.isFailure(failure)).toBe(true)
      expect(created).toEqual([])
      expect(yield* fixture.shell.list()).toEqual([])
      expect(yield* Effect.promise(() => fs.readdir(fixture.outputRoot))).toEqual([])
    }),
  ),
)

it.live("preserves a fast command's completed result before acquisition returns", () =>
  withShell({}, (fixture) =>
    Effect.gen(function* () {
      const created = yield* Deferred.make<Info>()
      const allowCreated = yield* Deferred.make<void>()
      yield* Effect.acquireRelease(
        fixture.bus.listen((event) =>
          Schema.is(Event.Created)(event)
            ? Deferred.succeed(created, event.data.info).pipe(Effect.andThen(Deferred.await(allowCreated)))
            : Effect.void,
        ),
        (unsubscribe) => unsubscribe,
      )
      const acquisition = yield* fixture.shell
        .create({ ...shellCommand, command: "exit 7" })
        .pipe(Effect.forkScoped({ startImmediately: true }))
      const started = yield* Deferred.await(created)
      const completed = yield* fixture.shell.wait(started.id)
      expect(completed).toMatchObject({ status: "exited", exit: 7 })
      yield* Deferred.succeed(allowCreated, undefined)
      const handedOff = yield* Fiber.join(acquisition)
      expect(handedOff).toMatchObject({ id: started.id, status: "exited", exit: 7 })
      expect(yield* fixture.shell.result(handedOff)).toMatchObject({
        info: { status: "exited", exit: 7 },
        capture: { output: "(no output)", truncated: false },
      })
      yield* fixture.shell.remove(started.id)
    }),
  ),
)
