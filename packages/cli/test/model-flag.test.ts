import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { Command } from "effect/cli"
import { Commands } from "../src/commands/commands"

test.each([
  { args: [], model: Option.none(), fork: false },
  { args: ["--model", "anthropic/claude-sonnet-4"], model: Option.some("anthropic/claude-sonnet-4"), fork: false },
  { args: ["-m", "zai-coding-plan/glm-5.2"], model: Option.some("zai-coding-plan/glm-5.2"), fork: false },
  { args: ["-s", "ses_test", "--fork"], model: Option.none(), fork: true },
])("default command parses the model and fork flags: $args", async ({ args, model, fork }) => {
  const received: { model: Option.Option<string>; fork: boolean }[] = []
  const command = Commands.spec.pipe(
    Command.withHandler((input) =>
      Effect.sync(() => {
        received.push({ model: input.model, fork: input.fork })
      }),
    ),
  )
  await Effect.runPromise(
    Command.runWith(command, { version: "test" })(args).pipe(Effect.provide(NodeServices.layer)),
  )
  expect(received).toEqual([{ model, fork }])
})
