import { describe, expect } from "bun:test"
import { Command } from "@opencode/core/command"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(Command.node))

describe("Command", () => {
  it.effect("registers and executes callback commands", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const calls: Command.Invocation[] = []
      yield* command.transform((editor) => {
        editor.add({
          name: "goal",
          description: "Manage the session goal",
          execute: (input) =>
            Effect.sync(() => {
              calls.push(input)
            }),
        })
      })

      expect(yield* command.get("goal")).toEqual(
        Command.Info.make({ name: "goal", description: "Manage the session goal" }),
      )
      const invocation = {
        sessionID: Session.ID.make("ses_test"),
        messageID: SessionMessage.ID.make("msg_goal"),
        prompt: { text: "ship it", files: [{ uri: "file:///tmp/plan.md" }] },
        delivery: "steer" as const,
      }
      expect(yield* command.execute({ name: "goal", invocation })).toEqual(Command.immediate)
      expect(calls).toEqual([invocation])
    }),
  )

  it.effect("returns prompt outcomes and rejects ones admitted under another message ID", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      yield* command.transform((editor) => {
        editor.add({ name: "ask", execute: (input) => Effect.succeed(Command.prompted({ id: input.messageID })) })
        editor.add({
          name: "stray",
          execute: () => Effect.succeed(Command.prompted({ id: SessionMessage.ID.make("msg_other") })),
        })
      })
      const invocation = {
        sessionID: Session.ID.make("ses_test"),
        messageID: SessionMessage.ID.make("msg_ask"),
        prompt: { text: "" },
        delivery: "steer" as const,
      }

      expect(yield* command.execute({ name: "ask", invocation })).toEqual(
        Command.prompted({ id: invocation.messageID }),
      )
      const error = yield* command.execute({ name: "stray", invocation }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Command.ExecutionError)
      expect(error.message).toBe("Command admitted msg_other instead of the invocation message ID msg_ask")
    }),
  )

  it.effect("replaces commands with later definitions", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      yield* command.transform((editor) => {
        editor.add({ name: "goal", description: "First", execute: () => Effect.void })
        editor.add({ name: "goal", description: "Second", execute: () => Effect.void })
      })

      expect(yield* command.list()).toEqual([Command.Info.make({ name: "goal", description: "Second" })])
    }),
  )

  it.effect("returns callback error messages without stack traces", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      yield* command.transform((editor) => {
        editor.add({
          name: "fail",
          execute: () => Effect.fail(new Error("command failed")),
        })
      })

      const error = yield* command
        .execute({
          name: "fail",
          invocation: {
            sessionID: Session.ID.make("ses_test"),
            messageID: SessionMessage.ID.make("msg_fail"),
            prompt: { text: "" },
            delivery: "steer",
          },
        })
        .pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "Command.ExecutionError", message: "command failed" })
    }),
  )
})
