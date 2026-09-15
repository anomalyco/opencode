import { describe, expect } from "bun:test"
import type { CommandDefinition } from "@opencode-ai/plugin/effect/command"
import { Event } from "@opencode-ai/schema/event"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { DateTime, Deferred, Effect, PubSub, Stream } from "effect"
import { GoalPlugin } from "@opencode-ai/core/plugin/goal"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_goal_test")

describe("GoalPlugin.Plugin", () => {
  it.effect("continues a goal until evaluation reports completion", () =>
    Effect.gen(function* () {
      const event: SessionEvent.Execution.Succeeded = {
        id: Event.ID.create(),
        created: 0,
        durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
        type: "session.execution.succeeded",
        data: { sessionID },
      }
      const events = yield* PubSub.unbounded<typeof event>()
      const completed = yield* Deferred.make<void>()
      const storage = new Map<string, unknown>()
      const descriptions = new Array<string>()
      let command: CommandDefinition | undefined

      yield* GoalPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            reload: () => Effect.die("unused command.reload"),
            transform: (callback) => {
              callback({ add: (definition) => (command = definition) })
              return Effect.succeed({ dispose: Effect.void })
            },
          },
          event: { subscribe: () => Stream.fromPubSub(events) },
          storage: {
            get: (key) => Effect.succeed(storage.get(key) as never),
            set: (key, value) => Effect.sync(() => storage.set(key, value)),
            remove: (key) => Effect.sync(() => storage.delete(key)),
            scan: () => Effect.die("unused storage.scan"),
          },
          session: {
            generate: () => Effect.succeed({ text: "COMPLETE" }),
            synthetic: (input) =>
              Effect.gen(function* () {
                descriptions.push(input.description ?? "")
                if (input.description === "Goal completed") yield* Deferred.succeed(completed, undefined)
                return SessionInbox.Synthetic.make({
                  id: SessionMessage.ID.create(),
                  sessionID: input.sessionID,
                  timeCreated: DateTime.makeUnsafe(0),
                  type: "synthetic",
                  payload: { text: input.text, description: input.description },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      )
      yield* Effect.yieldNow
      if (!command) return yield* Effect.die("Goal command was not registered")

      yield* command.execute({ sessionID, prompt: { text: "Finish the task" }, delivery: "steer" })
      yield* PubSub.publish(events, event)
      yield* Deferred.await(completed)

      expect(descriptions).toEqual(["Goal started: Finish the task", "Goal completed"])
      expect(storage.get(`session/${sessionID}/goal`)).toEqual({ goal: "Finish the task", active: false })
    }),
  )
})
