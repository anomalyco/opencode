import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue, Scope, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { ExitCode, makeHandle, ProcessId } from "effect/unstable/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"

const events: string[] = []
let beforeShellEvent = (_type: string): Effect.Effect<void> => Effect.void
const busBase = Bus.configured()
const observedBus = makeGlobalNode({
  service: Bus.Service,
  layer: Layer.effect(
    Bus.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const publish: Bus.Interface["publish"] = (definition, data, options) =>
        beforeShellEvent(definition.type).pipe(
          Effect.andThen(bus.publish(definition, data, options)),
          Effect.tap(() =>
            Effect.sync(() => {
              if (definition.type.startsWith("shell.")) events.push(definition.type)
            }),
          ),
        )
      return Bus.Service.of({ ...bus, publish })
    }),
  ),
  deps: [busBase],
})

it.live("serializes removal across exit settlement and publication", () =>
  Effect.gen(function* () {
    events.length = 0
    beforeShellEvent = () => Effect.void
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        beforeShellEvent = () => Effect.void
      }),
    )
    const completions = yield* Queue.unbounded<{
      readonly exit: Effect.Effect<void>
      readonly releaseOutput: Effect.Effect<void>
      readonly settled: Effect.Effect<void>
    }>()
    const environment = Layer.effect(
      Environment.Service,
      Effect.gen(function* () {
        const host = yield* Environment.Service
        const scope = yield* Scope.Scope
        return Environment.Service.of({
          ...host,
          spawner: ChildProcessSpawner.make(() =>
            Effect.gen(function* () {
              const exited = yield* Deferred.make<ExitCode>()
              const outputReady = yield* Deferred.make<void>()
              const observer = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
              yield* Queue.offer(
                completions,
                {
                  exit: Deferred.succeed(exited, ExitCode(0)).pipe(Effect.asVoid),
                  releaseOutput: Deferred.succeed(outputReady, undefined),
                  settled: Effect.gen(function* () {
                    // Shell.wait resolves before retention runs; join the whole exit handler instead.
                    const fiber = yield* Deferred.await(observer)
                    yield* Fiber.join(fiber).pipe(Effect.orDie)
                  }),
                },
              )
              const output = Stream.fromEffect(Deferred.await(outputReady)).pipe(
                Stream.map(() => Buffer.from("hello")),
              )
              return makeHandle({
                pid: ProcessId(1),
                exitCode: Effect.withFiber((fiber) =>
                  Scope.addFinalizer(scope, Fiber.interrupt(fiber)).pipe(
                    Effect.andThen(Deferred.succeed(observer, fiber)),
                    Effect.andThen(Deferred.await(exited)),
                  ),
                ),
                isRunning: Deferred.isDone(exited).pipe(Effect.map((done) => !done)),
                kill: () => Deferred.succeed(exited, ExitCode(0)).pipe(Effect.asVoid),
                stdin: Sink.drain,
                stdout: output,
                stderr: Stream.empty,
                all: output,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              })
            }),
          ),
        })
      }),
    ).pipe(Layer.provide(hostEnvironmentLayer))

    yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      const removedBeforeExit = yield* shell.create({ shell: "sh", command: "removed before exit", timeout: 0 })
      const beforeExitControl = yield* Queue.take(completions)
      yield* shell.remove(removedBeforeExit.id)
      yield* beforeExitControl.exit
      yield* beforeExitControl.releaseOutput
      yield* beforeExitControl.settled
      expect(events).toEqual(["shell.created", "shell.deleted"])
      expect(yield* Effect.promise(() => Bun.file(removedBeforeExit.file).exists())).toBe(false)

      events.length = 0
      const removed = yield* shell.create({ shell: "sh", command: "removed", timeout: 0 })
      const removedControl = yield* Queue.take(completions)
      yield* removedControl.exit
      const waitForExit = (remaining = 1_000): Effect.Effect<void, Error> =>
        shell.get(removed.id).pipe(
          Effect.flatMap((info) => {
            if (info.status === "exited") return Effect.void
            if (remaining === 0) return Effect.fail(new Error("Timed out waiting for exit observer"))
            return Effect.yieldNow.pipe(Effect.andThen(waitForExit(remaining - 1)))
          }),
        )
      yield* waitForExit()
      const removingDuringOutput = yield* shell.remove(removed.id).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      yield* removedControl.releaseOutput
      yield* Fiber.join(removingDuringOutput)
      expect((yield* shell.result(removed)).capture).toBeUndefined()
      expect(yield* shell.remove(removed.id).pipe(Effect.flip)).toBeInstanceOf(Shell.NotFoundError)
      yield* removedControl.settled
      expect(events).toEqual(["shell.created", "shell.exited", "shell.deleted"])
      expect(yield* Effect.promise(() => Bun.file(removed.file).exists())).toBe(false)

      events.length = 0
      const publishing = yield* Deferred.make<void>()
      const deleting = yield* Deferred.make<void>()
      const releasePublish = yield* Deferred.make<void>()
      beforeShellEvent = (type) =>
        type === "shell.exited"
          ? Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(releasePublish)))
          : type === "shell.deleted"
            ? Deferred.succeed(deleting, undefined).pipe(Effect.asVoid)
            : Effect.void
      const removedDuringPublish = yield* shell.create({ shell: "sh", command: "removed during publish", timeout: 0 })
      const publishControl = yield* Queue.take(completions)
      yield* publishControl.releaseOutput
      yield* publishControl.exit
      yield* Deferred.await(publishing)
      const removing = yield* Deferred.make<void>()
      const removal = yield* Deferred.succeed(removing, undefined).pipe(
        Effect.andThen(shell.remove(removedDuringPublish.id)),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(removing)
      const deletionStarted = (remaining = 1_000): Effect.Effect<boolean> =>
        Deferred.isDone(deleting).pipe(
          Effect.flatMap((done) =>
            done || remaining === 0
              ? Effect.succeed(done)
              : Effect.yieldNow.pipe(Effect.andThen(deletionStarted(remaining - 1))),
          ),
        )
      expect(yield* deletionStarted()).toBe(false)
      yield* Deferred.succeed(releasePublish, undefined)
      yield* publishControl.settled
      yield* Fiber.join(removal)
      expect(events).toEqual(["shell.created", "shell.exited", "shell.deleted"])
      expect(yield* Effect.promise(() => Bun.file(removedDuringPublish.file).exists())).toBe(false)
      beforeShellEvent = () => Effect.void

      const complete = Effect.gen(function* () {
        const info = yield* shell.create({ shell: "sh", command: "hello", timeout: 0 })
        const control = yield* Queue.take(completions)
        yield* control.releaseOutput
        yield* control.exit
        yield* control.settled
        return info
      })
      const oldest = yield* complete
      // Exceed the 25-entry retention cap with the removed ID at the head of exitOrder.
      yield* Effect.forEach(Array.from({ length: 25 }), () => complete, { discard: true })
      expect(yield* shell.get(oldest.id).pipe(Effect.flip)).toBeInstanceOf(Shell.NotFoundError)

      const survivor = yield* complete
      expect(yield* shell.result(survivor)).toMatchObject({
        info: { status: "exited", exit: 0 },
        capture: { output: "hello", truncated: false },
      })
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(Shell.node, [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(environment),
          Bus.node.replace(observedBus),
        ]),
      ),
    )
  }),
)

it.live("interrupts acquisition before command registration without lifecycle events", () =>
  Effect.gen(function* () {
    events.length = 0
    const spawning = yield* Deferred.make<void>()
    const environment = Layer.effect(
      Environment.Service,
      Effect.gen(function* () {
        const host = yield* Environment.Service
        return Environment.Service.of({
          ...host,
          spawner: ChildProcessSpawner.make(() =>
            Deferred.succeed(spawning, undefined).pipe(Effect.andThen(Effect.never)),
          ),
        })
      }),
    ).pipe(Layer.provide(hostEnvironmentLayer))

    yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      const caller = yield* shell
        .create({ shell: "sh", command: "blocked spawn", timeout: 0 })
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(spawning)
      yield* Fiber.interrupt(caller)

      expect(Exit.hasInterrupts(yield* Fiber.await(caller))).toBe(true)
      expect(yield* shell.list()).toEqual([])
      expect(events).toEqual([])
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(Shell.node, [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(environment),
          Bus.node.replace(observedBus),
        ]),
      ),
    )
  }),
)

it.live("keeps spawn failure free of shell authority", () =>
  Effect.gen(function* () {
    events.length = 0
    yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      const result = yield* shell
        .create({ shell: "nonexistent-shell-33364", command: "never runs", timeout: 0 })
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toMatchObject({ _tag: "AppProcessError" })
      expect(yield* shell.list()).toEqual([])
      expect(events).toEqual([])
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(Shell.node, [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(hostEnvironmentLayer),
          Bus.node.replace(observedBus),
        ]),
      ),
    )
  }),
)
