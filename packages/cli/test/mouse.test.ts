import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { Command } from "effect/cli"
import { Commands } from "../src/commands/commands"

test.each([
  { args: [], mouse: undefined },
  { args: ["--mouse"], mouse: true },
  { args: ["--no-mouse"], mouse: false },
])("parses the optional mouse override: $args", async ({ args, mouse }) => {
  const received: (boolean | undefined)[] = []
  const command = Commands.spec.pipe(
    Command.withHandler((input) => Effect.sync(() => void received.push(Option.getOrUndefined(input.mouse)))),
  )

  await Effect.runPromise(Command.runWith(command, { version: "test" })(args).pipe(Effect.provide(NodeServices.layer)))
  expect(received).toEqual([mouse])
})
