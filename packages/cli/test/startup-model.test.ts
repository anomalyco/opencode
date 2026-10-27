import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { Command } from "effect/cli"
import { Commands } from "../src/commands/commands"

test.each([
  { args: [], model: undefined, standalone: false },
  { args: ["--model", "ollama/selected"], model: "ollama/selected", standalone: false },
  { args: ["-m", "ollama/selected"], model: "ollama/selected", standalone: false },
  { args: ["--standalone", "--model", "ollama/selected"], model: "ollama/selected", standalone: true },
  {
    args: ["--server", "http://127.0.0.1:9", "-m", "ollama/selected"],
    model: "ollama/selected",
    standalone: false,
  },
])("the startup command accepts a model selection: $args", async ({ args, model, standalone }) => {
  const received: { model?: string; standalone: boolean }[] = []
  const command = Commands.spec.pipe(
    Command.withHandler((input) =>
      Effect.sync(
        () => void received.push({ model: Option.getOrUndefined(input.model), standalone: input.standalone }),
      ),
    ),
  )
  await Effect.runPromise(Command.runWith(command, { version: "test" })(args).pipe(Effect.provide(NodeServices.layer)))
  expect(received).toEqual([{ model, standalone }])
})
