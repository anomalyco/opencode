import { NodeServices } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { EffectFlock } from "@opencode/util/effect-flock"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, spyOn } from "bun:test"
import { Clock, Deferred, Duration, Effect, Exit, Fiber, FileSystem, Layer, Queue, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { TestClock } from "effect/testing"
import path from "node:path"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { Updater } from "../src/services/updater"

const it = testEffect(NodeServices.layer)
const version = "2.3.4"
const bash = process.platform === "win32" ? "C:\\fixture\\bash.exe" : "bash"

function fixture(stallDownload = false) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-updater-timeout-" })
    const global = Layer.succeed(
      Global.Service,
      Global.make({ home: root, cache: path.join(root, "cache"), state: path.join(root, "state") }),
    )
    const commands: string[] = []
    const started = yield* Queue.unbounded<{
      command: string
      exited: Deferred.Deferred<ExitCode>
      released: Deferred.Deferred<void>
    }>()

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(async () => Response.json({ version, metadata: { package: "@opencode/cli" } }), {
            preconnect: fetch.preconnect,
          }),
        ),
      ),
      (request) => Effect.sync(() => request.mockRestore()),
    )

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (command._tag !== "StandardCommand") return yield* Effect.die("Unexpected piped upgrade command")
        commands.push(command.command)
        const exited = yield* Deferred.make<ExitCode>()
        const released = yield* Deferred.make<void>()
        const child = { command: command.command, exited, released }
        if (command.command === "curl" && !stallDownload) yield* Deferred.succeed(exited, ExitCode(0))
        const stop = Deferred.succeed(exited, ExitCode(143)).pipe(Effect.asVoid)
        return yield* Effect.acquireRelease(
          Effect.succeed(
            makeHandle({
              pid: ProcessId(1),
              exitCode: Queue.offer(started, child).pipe(Effect.andThen(Deferred.await(exited))),
              isRunning: Deferred.isDone(exited).pipe(Effect.map((done) => !done)),
              kill: () => stop,
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            }),
          ),
          () => stop.pipe(Effect.andThen(Deferred.succeed(released, undefined))),
        )
      }),
    )
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layer),
      Effect.provide([
        global,
        LayerNode.compile(EffectFlock.node, {
          replacements: [Global.node.replace(global)],
        }),
        LayerNode.compile(AppProcess.node, {
          replacements: [
            CrossSpawnSpawner.node.replace(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
          ],
        }),
      ]),
    )
    const upgrade = (method: Updater.Method) =>
      method === "curl" && process.platform === "win32"
        ? withEnv({ OPENCODE_GIT_BASH_PATH: bash }, () => updater.upgrade(method, version))
        : updater.upgrade(method, version)
    return { upgrade, commands, started }
  })
}

for (const method of Updater.methods) {
  it.effect(`${method === "curl" ? "bash installer" : method} survives a slow install`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const install = yield* test.upgrade(method).pipe(Effect.forkScoped)
      if (method === "curl") expect((yield* Queue.take(test.started)).command).toBe("curl")
      const child = yield* Queue.take(test.started)
      expect(child.command).toBe(method === "curl" ? bash : method)

      yield* TestClock.adjust("7 minutes")
      expect(yield* Deferred.isDone(child.released)).toBe(false)
      expect(yield* Deferred.succeed(child.exited, ExitCode(0))).toBe(true)
      yield* Fiber.join(install)
      expect(yield* Deferred.isDone(child.released)).toBe(true)
    }),
  )
}

it.effect("a stalled installer script download expires at five minutes", () =>
  Effect.gen(function* () {
    const test = yield* fixture(true)
    const download = yield* test.upgrade("curl").pipe(Effect.flip, Effect.forkScoped)
    const child = yield* Queue.take(test.started)

    yield* TestClock.adjust("299 seconds")
    expect(yield* Deferred.isDone(child.released)).toBe(false)
    yield* TestClock.adjust("1 second")
    expect(yield* Fiber.join(download)).toMatchObject({
      title: "Could not download the OpenCode installer",
      detail: "Timed out",
    })
    expect(yield* Deferred.isDone(child.released)).toBe(true)
    expect(test.commands).toEqual(["curl"])
  }),
)

it.effect("interrupting an npm upgrade cancels the child", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const install = yield* test.upgrade("npm").pipe(Effect.forkScoped)
    const child = yield* Queue.take(test.started)

    yield* Fiber.interrupt(install)
    expect(Exit.hasInterrupts(yield* Fiber.await(install))).toBe(true)
    expect(yield* Deferred.isDone(child.released)).toBe(true)
    expect(yield* Deferred.await(child.exited)).toBe(ExitCode(143))
  }),
)

it.effect("a waiting upgrade times out without stopping the lock holder", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const holder = yield* test.upgrade("npm").pipe(Effect.forkScoped)
    const child = yield* Queue.take(test.started)
    yield* TestClock.adjust("7 minutes")
    expect(yield* Deferred.isDone(child.released)).toBe(false)

    const clock = yield* Clock.Clock
    const deadline = yield* Deferred.make<number>()
    const contender = yield* test.upgrade("npm").pipe(
      Effect.flip,
      Effect.provideService(Clock.Clock, {
        ...clock,
        // Wait for flock to schedule the acquisition deadline after its filesystem setup.
        sleep: (duration) =>
          Duration.toMillis(duration) >= 60_000
            ? Deferred.succeed(deadline, Duration.toMillis(duration)).pipe(Effect.andThen(clock.sleep(duration)))
            : clock.sleep(duration),
      }),
      Effect.forkScoped,
    )
    const wait = yield* Deferred.await(deadline)
    yield* TestClock.adjust(wait - 1)
    expect(contender.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust(1)
    const error = yield* Fiber.join(contender)
    expect(wait).toBe(Duration.toMillis("15 minutes"))
    expect(error).toBeInstanceOf(Updater.UpgradeError)
    expect(error).toMatchObject({
      title: "Another OpenCode upgrade is still running",
      detail: expect.stringContaining("existing upgrade was not stopped"),
      command: `opencode upgrade ${version} --method npm`,
      retry: expect.stringContaining("finish"),
    })
    expect(test.commands).toEqual(["npm"])
    expect(yield* Deferred.isDone(child.released)).toBe(false)
    expect(yield* Deferred.succeed(child.exited, ExitCode(0))).toBe(true)
    yield* Fiber.join(holder)
  }),
)
