import { describe, expect, test } from "bun:test"
import { DateTime, Duration, Effect, Exit, PubSub, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "@opencode/core/bus"
import { Command } from "@opencode/core/command"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LoopPlugin } from "@opencode/core/plugin/loop"
import { SessionEvent } from "@opencode/core/session/event"
import { Session } from "@opencode/schema/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Command.node, Bus.node])))
const sessionID = Session.ID.make("ses_test")

type Sent = { text: string; delivery?: "steer" | "queue"; command?: string }

const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

const start = Effect.fnUntraced(function* () {
  const command = yield* Command.Service
  const events = yield* PubSub.unbounded<{ type: string; data: Record<string, unknown> }>()
  const sent: Sent[] = []
  yield* LoopPlugin.Plugin.effect(
    host({
      command: {
        list: () => Effect.die("unused command.list"),
        transform: command.transform,
        reload: command.reload,
      },
      session: {
        prompt: (input) =>
          Effect.sync(() => {
            sent.push({ text: input.text, delivery: input.delivery })
            return SessionInbox.User.make({
              id: SessionMessage.ID.make("msg_test"),
              sessionID: input.sessionID,
              time: { created: DateTime.makeUnsafe(0) },
              type: "user",
              payload: { text: input.text },
              delivery: input.delivery ?? "steer",
            })
          }),
        command: (input) =>
          input.name === "missing"
            ? Effect.fail(new Error("Command not found: missing"))
            : Effect.sync(() => {
                sent.push({ command: input.name, text: input.text, delivery: input.delivery })
              }),
      },
    }),
  ).pipe(
    Effect.provideService(
      Bus.Service,
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      { subscribe: () => Stream.fromPubSub(events) } as unknown as Bus.Interface,
    ),
  )
  yield* settle
  const loop = (text: string) =>
    command.execute({ name: "loop", invocation: { sessionID, prompt: { text }, delivery: "steer" } })
  const emit = (type: string, data: Record<string, unknown> = {}) =>
    PubSub.publish(events, { type, data: { sessionID, ...data } }).pipe(Effect.andThen(settle))
  const wait = (duration: Duration.Input) => TestClock.adjust(duration).pipe(Effect.andThen(settle))
  return { loop, emit, wait, sent }
})

describe("LoopPlugin", () => {
  test("parses the interval and prompt", () => {
    expect(LoopPlugin.parse("stop")).toEqual({ type: "stop" })
    expect(LoopPlugin.parse("5m check the deploy")).toMatchObject({
      type: "start",
      every: Duration.minutes(5),
      prompt: "check the deploy",
      command: undefined,
    })
    expect(LoopPlugin.parse("check the deploy")).toMatchObject({ every: Duration.minutes(10) })
    expect(LoopPlugin.parse("2h /review branch")).toMatchObject({
      every: Duration.hours(2),
      command: { name: "review", text: "branch" },
    })
    expect(LoopPlugin.parse("5minutes later")).toMatchObject({ prompt: "5minutes later" })
    expect(LoopPlugin.parse("")).toBeUndefined()
    expect(LoopPlugin.parse("30s")).toBeUndefined()
    expect(LoopPlugin.parse("1m /loop 1m hi")).toBeUndefined()
  })

  it.effect("repeats the prompt until /loop stop and skips ticks while busy", () =>
    Effect.gen(function* () {
      const { loop, emit, wait, sent } = yield* start()
      yield* loop("5m say hi")
      expect(sent).toEqual([{ text: "say hi", delivery: "steer" }])
      yield* wait("5 minutes")
      expect(sent).toHaveLength(2)
      expect(sent[1]).toEqual({ text: "say hi", delivery: "queue" })

      yield* emit(SessionEvent.Execution.Started.type)
      yield* wait("5 minutes")
      expect(sent).toHaveLength(2)
      yield* emit(SessionEvent.Execution.Succeeded.type)
      yield* wait("5 minutes")
      expect(sent).toHaveLength(3)

      yield* loop("stop")
      yield* wait("20 minutes")
      expect(sent).toHaveLength(3)
    }),
  )

  it.effect("starting a new loop replaces the old one", () =>
    Effect.gen(function* () {
      const { loop, wait, sent } = yield* start()
      yield* loop("1m first")
      yield* loop("1m second")
      yield* wait("1 minute")
      expect(sent.map((item) => item.text)).toEqual(["first", "second", "second"])
    }),
  )

  it.effect("interrupting the session stops the loop", () =>
    Effect.gen(function* () {
      const { loop, emit, wait, sent } = yield* start()
      yield* loop("1m say hi")
      yield* emit(SessionEvent.Execution.Started.type)
      yield* emit(SessionEvent.Execution.Interrupted.type, { reason: "user" })
      yield* wait("5 minutes")
      expect(sent).toHaveLength(1)
    }),
  )

  it.effect("loops another command", () =>
    Effect.gen(function* () {
      const { loop, wait, sent } = yield* start()
      yield* loop("30m /review branch")
      yield* wait("30 minutes")
      expect(sent).toEqual([
        { command: "review", text: "branch", delivery: "steer" },
        { command: "review", text: "branch", delivery: "queue" },
      ])
    }),
  )

  it.effect("fails with usage for an empty prompt and drops a loop whose first run fails", () =>
    Effect.gen(function* () {
      const { loop, wait, sent } = yield* start()
      const empty = yield* loop("10m").pipe(Effect.exit)
      expect(Exit.isFailure(empty)).toBe(true)
      expect(String(empty)).toContain("Usage: /loop")
      expect(Exit.isFailure(yield* loop("1m /missing").pipe(Effect.exit))).toBe(true)
      yield* wait("5 minutes")
      expect(sent).toEqual([])
    }),
  )
})
