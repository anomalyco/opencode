import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { ShellPhase } from "@opencode/core/shell/phase"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"

const timer = Effect.runFork(Effect.void)
const stale = Effect.runFork(Effect.void)
const exited: ShellPhase.Outcome = { status: "exited", exit: 0, completed: 1 }
const timedOut: ShellPhase.Outcome = { status: "timeout", completed: 2 }

describe("ShellPhase.transition", () => {
  test.each<[string, ShellPhase.State, ShellPhase.Event, ShellPhase.State]>([
    [
      "exit ends a running command",
      { status: "running", timer },
      { type: "exit-observed", outcome: exited },
      { status: "ending", outcome: exited },
    ],
    [
      "current timer times out",
      { status: "running", timer },
      { type: "timed-out", timer, completed: 2 },
      { status: "ending", outcome: timedOut },
    ],
    [
      "superseded timer is ignored",
      { status: "running", timer },
      { type: "timed-out", timer: stale, completed: 2 },
      { status: "running", timer },
    ],
    [
      "retime replaces the timer",
      { status: "running", timer: stale },
      { type: "retimed", timer },
      { status: "running", timer },
    ],
    ["retime to zero clears the timer", { status: "running", timer }, { type: "retimed" }, { status: "running" }],
    ["output drained before exit waits", { status: "running" }, { type: "output-drained" }, { status: "running" }],
    [
      "exit after timeout keeps the timeout",
      { status: "ending", outcome: timedOut },
      { type: "exit-observed", outcome: exited },
      { status: "ending", outcome: timedOut },
    ],
    [
      "retime while ending is ignored",
      { status: "ending", outcome: exited },
      { type: "retimed", timer },
      { status: "ending", outcome: exited },
    ],
    [
      "drained output settles",
      { status: "ending", outcome: exited },
      { type: "output-drained" },
      { status: "terminal" },
    ],
    ["remove while running", { status: "running", timer }, { type: "removed" }, { status: "removed" }],
    ["remove while ending", { status: "ending", outcome: timedOut }, { type: "removed" }, { status: "removed" }],
    ["remove after terminal", { status: "terminal" }, { type: "removed" }, { status: "removed" }],
    ["late drain after removal", { status: "removed" }, { type: "output-drained" }, { status: "removed" }],
    [
      "late exit after removal",
      { status: "removed" },
      { type: "exit-observed", outcome: exited },
      { status: "removed" },
    ],
  ])("%s", (_, state, event, expected) => {
    expect(ShellPhase.transition(state, event)).toEqual(expected)
  })
})

it.live("removing a timed-out command before it exits reports the timeout", () =>
  Effect.gen(function* () {
    const killed = yield* Deferred.make<void>()
    // The process ignores the timeout's kill and never exits, holding the command in its ending phase.
    const environment = Layer.effect(
      Environment.Service,
      Effect.gen(function* () {
        const host = yield* Environment.Service
        return Environment.Service.of({
          ...host,
          spawner: ChildProcessSpawner.make(() =>
            Effect.succeed(
              makeHandle({
                pid: ProcessId(1),
                exitCode: Effect.never,
                isRunning: Effect.succeed(true),
                kill: () => Deferred.succeed(killed, undefined).pipe(Effect.asVoid),
                stdin: Sink.drain,
                stdout: Stream.empty,
                stderr: Stream.empty,
                all: Stream.empty,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              }),
            ),
          ),
        })
      }),
    ).pipe(Layer.provide(hostEnvironmentLayer))

    yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      const bus = yield* Bus.Service
      const exits = yield* bus.subscribe().pipe(
        Stream.filter((event) => event.type === "shell.exited"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )
      const info = yield* shell.create({ shell: "sh", command: "ignores kill", timeout: 1 })
      yield* Deferred.await(killed)
      expect((yield* shell.get(info.id)).status).toBe("running")
      yield* shell.remove(info.id)
      expect((yield* Fiber.join(exits)).map((event) => event.data)).toEqual([{ id: info.id, status: "timeout" }])
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Shell.node, Bus.node]), [
          Location.node.replace(tempLocationLayer),
          Global.node.replace(tempGlobalLayer),
          Config.node.replace(Config.testLayer()),
          Environment.node.replace(environment),
        ]),
      ),
    )
  }),
)
