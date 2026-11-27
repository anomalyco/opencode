import { expect } from "bun:test"
import { Effect, Exit, Layer, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { Global } from "@opencode/util/global"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"

const neverEnding = (record: (event: string) => Effect.Effect<unknown>) =>
  AppNodeBuilder.build(Shell.node, [
    Location.node.replace(tempLocationLayer),
    Global.node.replace(tempGlobalLayer),
    Config.node.replace(Config.testLayer()),
    Environment.node.replace(
      Layer.succeed(
        Environment.Service,
        // A command that never exits or ends its output on its own, so only interruption stops its fibers.
        Environment.local(
          ChildProcessSpawner.make(() =>
            Effect.gen(function* () {
              // Releasing the spawn scope is what kills a real process.
              yield* Effect.addFinalizer(() => record("released"))
              return makeHandle({
                pid: ProcessId(1),
                exitCode: Effect.never.pipe(Effect.onInterrupt(() => record("exit watch"))),
                isRunning: Effect.succeed(true),
                kill: () => Effect.void,
                stdin: Sink.drain,
                stdout: Stream.never,
                stderr: Stream.empty,
                all: Stream.never.pipe(Stream.ensuring(record("output"))),
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              })
            }),
          ),
        ),
      ),
    ),
    PersistentPty.node.replace(disabledPersistentPtyLayer),
  ])

it.live("closing the Location stops its running commands' fibers before it finishes closing", () =>
  Effect.gen(function* () {
    const stopped = new Set<string>()
    const info = yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      return yield* shell.create({ shell: "sh", command: "running", timeout: 0 })
    }).pipe(Effect.provide(neverEnding((event) => Effect.sync(() => stopped.add(event)))))

    expect(info.status).toBe("running")
    expect([...stopped].toSorted()).toEqual(["exit watch", "output", "released"])
  }),
)

it.live("creating a command after its Location closed is interrupted instead of waiting forever", () =>
  Effect.gen(function* () {
    const shell = yield* Shell.Service.pipe(Effect.provide(neverEnding(() => Effect.void)))
    const exit = yield* shell.create({ shell: "sh", command: "late", timeout: 0 }).pipe(Effect.exit)
    expect(Exit.hasInterrupts(exit)).toBe(true)
  }),
)
