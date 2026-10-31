import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { Command } from "effect/cli"
import { Commands } from "../src/commands/commands"

test.each([
  { args: [], agent: Option.none() },
  { args: ["--agent", "plan"], agent: Option.some("plan") },
  { args: ["-s", "ses_test", "--agent", "plan"], agent: Option.some("plan") },
])("default command parses the agent flag: $args", async ({ args, agent }) => {
  const received: Option.Option<string>[] = []
  const command = Commands.spec.pipe(Command.withHandler((input) => Effect.sync(() => void received.push(input.agent))))
  await Effect.runPromise(Command.runWith(command, { version: "test" })(args).pipe(Effect.provide(NodeServices.layer)))
  expect(received).toEqual([agent])
})
