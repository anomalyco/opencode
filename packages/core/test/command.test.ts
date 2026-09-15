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
      expect(yield* command.execute({ name: "goal", invocation })).toEqual({ type: "immediate" })
      expect(calls).toEqual([invocation])
    }),
  )

  it.effect("returns prompt outcomes admitted with the invocation message ID", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      yield* command.transform((editor) => {
        editor.add({
          name: "ask",
          execute: (input) => Effect.succeed({ type: "prompt" as const, inboxID: input.messageID }),
        })
        editor.add({
          name: "stray",
          execute: () => Effect.succeed({ type: "prompt" as const, inboxID: SessionMessage.ID.make("msg_other") }),
        })
        editor.add({
          name: "junk",
          execute: () => Effect.succeed(true as unknown as Command.Outcome),
        })
      })
      const invocation = {
        sessionID: Session.ID.make("ses_test"),
        messageID: SessionMessage.ID.make("msg_ask"),
        prompt: { text: "" },
        delivery: "steer" as const,
      }

      expect(yield* command.execute({ name: "ask", invocation })).toEqual({
        type: "prompt",
        inboxID: invocation.messageID,
      })
      const error = yield* command.execute({ name: "stray", invocation }).pipe(Effect.flip)
      expect(error).toMatchObject({
        _tag: "Command.ExecutionError",
        command: "stray",
        message: "Command admitted msg_other instead of the invocation message ID msg_ask",
      })
      const junk = yield* command.execute({ name: "junk", invocation }).pipe(Effect.flip)
      expect(junk).toMatchObject({
        _tag: "Command.ExecutionError",
        command: "junk",
        message: "Command returned an invalid outcome (boolean)",
      })
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
