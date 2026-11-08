import { expect } from "bun:test"
import path from "path"
import { readdir, rm, writeFile } from "fs/promises"
import { Deferred, Effect, Fiber, Layer, Queue, Scope, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Shell } from "@opencode/core/shell"
import { Workspace } from "@opencode/core/workspace"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { location, tempLocationLayer } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

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

it.live("reports a capture failure instead of empty output when the output file cannot be written", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const data = path.join(tmp.path, "data")
    yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      // Replace the project output dir with a regular file so opening "<dir>/<id>.out" fails for any user, root included.
      const dir = path.join(data, "shell")
      const projects = yield* Effect.promise(() => readdir(dir))
      yield* Effect.promise(() =>
        Promise.all(
          projects.map(async (project) => {
            await rm(path.join(dir, project), { recursive: true })
            await writeFile(path.join(dir, project), "")
          }),
        ),
      )
      const info = yield* shell.create({ shell: "/bin/sh", command: "echo hello", timeout: 0 })
      const { capture } = yield* shell.result(info)
      expect(capture?.output).toContain("output capture failed")
      expect(capture?.output).not.toBe("(no output)")
      const first = yield* shell.output(info.id)
      expect(first.output).toContain("output capture failed")
      expect(first.cursor).toBeGreaterThan(0)
      expect((yield* shell.output(info.id, { cursor: first.cursor })).output).toBe("")
      expect((yield* shell.output(info.id, { cursor: 1 })).output).toBe("")
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(Shell.node, [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(
            Global.layerWith({
              data,
              cache: path.join(tmp.path, "cache"),
              config: path.join(tmp.path, "config"),
              state: path.join(tmp.path, "state"),
              tmp: path.join(tmp.path, "tmp"),
              bin: path.join(tmp.path, "cache", "bin"),
              log: path.join(data, "log"),
              repos: path.join(data, "repos"),
            }),
          ),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(hostEnvironmentLayer),
        ]),
      ),
    )
  }).pipe(Effect.scoped),
)
