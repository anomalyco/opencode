import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Queue, Layer } from "effect"
import { CommandSession } from "@opencode-ai/core/command-session"
import { CommandEvent } from "@opencode-ai/schema/command-event"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "../lib/effect"
import { location } from "../fixture/location"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/tmp") })),
)
const configLayer = Layer.mock(Config.Service)({ entries: () => Effect.succeed([]) })

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([CommandSession.node, EventV2.node]), [
    [Config.node, configLayer],
    [Location.node, locationLayer],
  ]),
)

const subscribeEvents = Effect.fn("CommandSessionTest.subscribeEvents")(function* () {
  const source = yield* EventV2.Service
  const events = yield* Queue.unbounded<any>()
  const unsubscribe = yield* source.listen((event) => {
    Queue.offer(events, event).pipe(Effect.ignore)
    return Effect.void
  })
  yield* Effect.addFinalizer(() => unsubscribe)
  return events
})

describe("command-session", () => {
  it.live("starts a command and returns session info", () =>
    Effect.gen(function* () {
      const session = yield* CommandSession.Service
      const result = yield* session.start({
        command: "sleep",
        args: ["60"],
        cwd: "/tmp",
      })

      expect(result.id).toBeDefined()
      expect(result.info.status).toBe("running")
      expect(result.info.pid).toBeGreaterThan(0)
      expect(result.info.command).toBe("sleep")
    }),
  )

  it.live("polls a running command and returns output", () =>
    Effect.gen(function* () {
      const session = yield* CommandSession.Service
      const result = yield* session.start({
        command: "echo",
        args: ["hello"],
        cwd: "/tmp",
      })

      // Wait for the command to complete
      yield* Effect.sleep("100 millis")

      const poll = yield* session.poll(result.id, { stdout: 0, stderr: 0 })
      expect(poll.info.exitCode).toBe(0)
      expect(poll.info.status).toBe("exited")
    }),
  )

  it.live("terminates a running command", () =>
    Effect.gen(function* () {
      const session = yield* CommandSession.Service
      const result = yield* session.start({
        command: "sleep",
        args: ["60"],
        cwd: "/tmp",
      })

      const terminate = yield* session.terminate(result.id)
      const info = yield* session.get(result.id)
      expect(info.status).toBe("terminated")
    }),
  )

  it.live("removes a session", () =>
    Effect.gen(function* () {
      const session = yield* CommandSession.Service
      const result = yield* session.start({
        command: "sleep",
        args: ["60"],
        cwd: "/tmp",
      })

      yield* session.remove(result.id)
      const removed = yield* session.get(result.id).pipe(Effect.exit)
      expect(Exit.isFailure(removed)).toBe(true)
    }),
  )

  it.live("returns not found for invalid session ID", () =>
    Effect.gen(function* () {
      const session = yield* CommandSession.Service
      const result = yield* session.get("invalid-id" as any).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }),
  )

  it.live("writes input to a running command", () =>
    Effect.gen(function* () {
      const session = yield* CommandSession.Service
      const result = yield* session.start({
        command: "cat",
        args: [],
        cwd: "/tmp",
      })

      yield* session.write(result.id, "test input\n", "stdout")

      // Give it time to process
      yield* Effect.sleep("100 millis")

      const info = yield* session.get(result.id)
      expect(info.status).toBe("running")
    }),
  )
})
