import { describe, expect } from "bun:test"
import { Bus } from "@opencode-ai/core/bus"
import { Command } from "@opencode-ai/core/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Session } from "@opencode-ai/schema/session"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Scope } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Command.node, Bus.node])))

describe("Command", () => {
  it.effect("registers and executes callback commands", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const calls: Command.Invocation[] = []
      yield* command.transform((draft) => {
        draft.add({
          name: "goal",
          description: "Manage the session goal",
          execute: (input) => Effect.sync(() => calls.push(input)),
        })
      })

      expect(yield* command.get("goal")).toEqual(
        Command.Info.make({ name: "goal", description: "Manage the session goal" }),
      )
      const invocation = {
        sessionID: Session.ID.make("ses_test"),
        prompt: { text: "ship it", files: [{ uri: "file:///tmp/plan.md" }] },
        delivery: "steer" as const,
      }
      yield* command.execute({ name: "goal", invocation })
      expect(calls).toEqual([invocation])
    }),
  )

  it.effect("replaces commands with later definitions", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      yield* command.transform((draft) => {
        draft.add({ name: "goal", description: "First", execute: () => Effect.void })
        draft.add({ name: "goal", description: "Second", execute: () => Effect.void })
      })

      expect(yield* command.list()).toEqual([Command.Info.make({ name: "goal", description: "Second" })])
    }),
  )

  it.effect("allows synchronous update listeners to mutate the registry", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const command = yield* Command.Service
      const scope = yield* Scope.Scope
      let reentered = false
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Command.Event.Updated.type || reentered) return Effect.void
        reentered = true
        return command
          .transform((draft) => {
            draft.add({ name: "listener", execute: () => Effect.void })
          })
          .pipe(Scope.provide(scope), Effect.asVoid)
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* command.transform((draft) => {
        draft.add({ name: "source", execute: () => Effect.void })
      })

      expect((yield* command.list()).map((item) => item.name)).toEqual(["source", "listener"])
    }),
  )

  it.effect("returns callback error messages without stack traces", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      yield* command.transform((draft) => {
        draft.add({
          name: "fail",
          execute: () => Effect.fail(new Error("command failed")),
        })
      })

      const error = yield* command
        .execute({
          name: "fail",
          invocation: {
            sessionID: Session.ID.make("ses_test"),
            prompt: { text: "" },
            delivery: "steer",
          },
        })
        .pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "Command.ExecutionError", message: "command failed" })
    }),
  )
})
