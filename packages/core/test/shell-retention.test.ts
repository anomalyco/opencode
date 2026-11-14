import childProcess from "node:child_process"
import { expect, spyOn } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Queue, Scope, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Shell } from "@opencode/core/shell"
import { Workspace } from "@opencode/core/workspace"
import { Global } from "@opencode/util/global"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { location, tempLocationLayer } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

it.effect("a shell timeout also bounds host process creation", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const proc = new childProcess.ChildProcess()
    const kill = spyOn(proc, "kill")
    const original = childProcess.spawn
    const executable = "opencode-stalled-launch"
    // Keep the real host spawner, replacing only an OS launch that never signals readiness.
    const spawn = spyOn(childProcess, "spawn").mockImplementation(
      new Proxy(original, {
        apply(target, receiver, args) {
          if (args[0] !== executable && (!Array.isArray(args[1]) || !args[1].join(" ").includes(executable)))
            // oxlint-disable-next-line no-restricted-globals -- Forward every native spawn overload with its receiver and arguments.
            return Reflect.apply(target, receiver, args)
          Deferred.doneUnsafe(entered, Exit.succeed(undefined))
          return proc
        },
      }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        spawn.mockRestore()
        kill.mockRestore()
      }),
    )
    yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      const pending = yield* shell
        .create({ shell: executable, command: "fixture", timeout: 200 })
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(entered)
      yield* TestClock.adjust("200 millis")
      expect(pending.pollUnsafe()).toMatchObject({ _tag: "Failure" })
      const error = yield* Fiber.join(pending).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "AppProcessError", cause: { _tag: "TimeoutError" } })
      expect(kill).toHaveBeenCalledWith("SIGTERM")
      expect(yield* shell.list()).toEqual([])
    }).pipe(
      Effect.ensuring(Effect.sync(() => proc.emit("error", new Error("fixture cleanup")))),
      Effect.provide(
        AppNodeBuilder.build(Shell.node, [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(hostEnvironmentLayer),
        ]),
      ),
    )
  }),
)

// The timeout is the contract; advance its clock only after real setup reaches the spawner.
for (const input of [
  { name: "zero timeout permits delayed process creation", timeout: 0 },
  { name: "process creation can finish before its timeout", timeout: 500 },
]) {
  it.effect(input.name, () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const environment = Layer.effect(
        Environment.Service,
        Effect.gen(function* () {
          const host = yield* Environment.Service
          const scope = yield* Scope.Scope
          return Environment.Service.of({
            ...host,
            spawner: ChildProcessSpawner.make(() =>
              Effect.withFiber((fiber) =>
                Scope.addFinalizer(scope, Fiber.interrupt(fiber)).pipe(
                  Effect.andThen(Deferred.succeed(entered, undefined)),
                  Effect.andThen(Deferred.await(release)),
                  Effect.as(
                    makeHandle({
                      pid: ProcessId(1),
                      exitCode: Effect.succeed(ExitCode(0)),
                      isRunning: Effect.succeed(false),
                      kill: () => Effect.void,
                      stdin: Sink.drain,
                      stdout: Stream.succeed(Buffer.from("ready")),
                      stderr: Stream.empty,
                      all: Stream.succeed(Buffer.from("ready")),
                      getInputFd: () => Sink.drain,
                      getOutputFd: () => Stream.empty,
                      unref: Effect.succeed(Effect.void),
                    }),
                  ),
                ),
              ),
            ),
          })
        }),
      ).pipe(Layer.provide(hostEnvironmentLayer))

      yield* Effect.gen(function* () {
        const shell = yield* Shell.Service
        const pending = yield* shell
          .create({ shell: "sh", command: "delayed", timeout: input.timeout })
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(entered)
        yield* TestClock.adjust("200 millis")
        expect(pending.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(release, undefined)
        const info = yield* Fiber.join(pending)
        expect(yield* shell.result(info)).toMatchObject({
          info: { status: "exited", exit: 0 },
          capture: { output: "ready", truncated: false },
        })
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(Shell.node, [
            Location.node.replace(tempLocationLayer),
            Global.node.replace(tempGlobalLayer),
            Config.node.replace(Config.testLayer()),
            Environment.node.replace(environment),
          ]),
        ),
      )
    }),
  )
}

it.live("eviction makes progress past an already-removed shell", () =>
  Effect.gen(function* () {
    const completions = yield* Queue.unbounded<Effect.Effect<void>>()
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
              const observer = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
              yield* Queue.offer(
                completions,
                Effect.gen(function* () {
                  yield* Deferred.succeed(exited, ExitCode(0))
                  // Shell.wait resolves before retention runs; join the whole exit handler instead.
                  const fiber = yield* Deferred.await(observer)
                  yield* Fiber.join(fiber).pipe(Effect.orDie)
                }),
              )
              const output = Stream.succeed(Buffer.from("hello"))
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
      const removed = yield* shell.create({ shell: "sh", command: "removed", timeout: 0 })
      const finishRemoved = yield* Queue.take(completions)
      yield* shell.remove(removed.id)
      expect((yield* shell.result(removed)).capture).toBeUndefined()
      yield* finishRemoved

      const complete = Effect.gen(function* () {
        const info = yield* shell.create({ shell: "sh", command: "hello", timeout: 0 })
        const finish = yield* Queue.take(completions)
        yield* finish
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
          PersistentPty.node.replace(disabledPersistentPtyLayer),
        ]),
      ),
    )
  }),
)

it.live("does not inherit host process.env when creating a shell in a workspace-backed location", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    let capturedEnv: Record<string, string | undefined> | undefined
    yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      const info = yield* shell.create({ shell: "/bin/sh", command: "printf ok", timeout: 0 }, (invocation) =>
        Effect.sync(() => {
          capturedEnv = { ...invocation.env }
        }),
      )
      expect(yield* shell.result(info)).toMatchObject({
        info: { status: "exited" },
      })
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(Shell.node, [
          Location.node.replace(
            Layer.succeed(
              Location.Service,
              Location.Service.of(
                location(
                  Location.Ref.make({
                    directory: AbsolutePath.make(tmp.path),
                    workspaceID: Workspace.ID.make("wrk_workspace"),
                  }),
                ),
              ),
            ),
          ),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(hostEnvironmentLayer),
        ]),
      ),
    )

    expect(process.env.PATH).toBeDefined()
    expect(capturedEnv).toEqual({
      TERM: "xterm-256color",
      OPENCODE_TERMINAL: "1",
    })
  }),
)
