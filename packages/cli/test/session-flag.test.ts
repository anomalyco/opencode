import { expect, test } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect, Option } from "effect"
import { Command } from "effect/unstable/cli"
import { Commands } from "../src/commands/commands"

test.each([
  { args: [], expected: { session: undefined } },
  { args: ["-s"], expected: { session: "" } },
  { args: ["--session"], expected: { session: "" } },
  { args: ["-s", ""], expected: { session: "" } },
  { args: ["--session="], expected: { session: "" } },
  { args: ["-s", "ses_123"], expected: { session: "ses_123" } },
  { args: ["--session", "ses_123"], expected: { session: "ses_123" } },
  { args: ["--session=ses_123"], expected: { session: "ses_123" } },
  { args: ["-s", "--continue"], expected: { session: "", continue: true } },
  { args: ["--continue", "-s"], expected: { session: "", continue: true } },
  { args: [".", "-s"], expected: { session: "", directory: "." } },
  { args: ["--prompt", "run", "-s"], expected: { session: "", prompt: "run" } },
  { args: ["--prompt=-s"], expected: { session: undefined, prompt: "-s" } },
  { args: ["--server", "http://localhost:4096", "-s"], expected: { session: "" } },
  { args: ["--", "-s"], expected: { session: undefined, directory: "-s" } },
  { args: ["-s", "--", "."], expected: { session: "", directory: "." } },
])("root session flag: $args", async ({ args, expected }) => {
  const result = await parse(args)
  expect(result.result._tag).toBe("Success")
  expect(result.calls).toMatchObject([{ command: "root", ...expected }])
})

test.each(["run", "mini"])("%s still requires an explicit session ID", async (command) => {
  for (const flag of ["-s", "--session"]) {
    const result = await parse([command, flag])
    expect(result.calls).toEqual([])
    expect(result.result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "ShowHelp",
        commandPath: [Commands.name, command],
        errors: [{ _tag: "InvalidValue", option: "session", value: "" }],
      },
    })
  }
  const result = await parse([command, "-s", "ses_123"])
  expect(result.result._tag).toBe("Success")
  expect(result.calls).toEqual([{ command, session: "ses_123" }])
})

test("other string flags still require a value", async () => {
  const result = await parse(["-s", "--prompt"])
  expect(result.calls).toEqual([])
  expect(result.result).toMatchObject({
    _tag: "Failure",
    failure: { _tag: "ShowHelp", errors: [{ _tag: "InvalidValue", option: "prompt", value: "" }] },
  })
})

async function parse(args: ReadonlyArray<string>) {
  const calls: Array<{
    command: string
    session?: string
    directory?: string
    prompt?: string
    continue?: boolean
  }> = []
  const command = Commands.spec.pipe(
    Command.withHandler((input) =>
      Effect.sync(() => {
        calls.push({
          command: "root",
          session: Option.getOrUndefined(input.session),
          directory: Option.getOrUndefined(input.directory),
          prompt: Option.getOrUndefined(input.prompt),
          continue: input.continue,
        })
      }),
    ),
    Command.withSubcommands([
      Commands.commands.run.spec.pipe(
        Command.withHandler((input) =>
          Effect.sync(() => {
            calls.push({ command: "run", session: Option.getOrUndefined(input.session) })
          }),
        ),
      ),
      Commands.commands.mini.spec.pipe(
        Command.withHandler((input) =>
          Effect.sync(() => {
            calls.push({ command: "mini", session: Option.getOrUndefined(input.session) })
          }),
        ),
      ),
    ]),
  )
  const result = await Effect.runPromise(
    Command.runWith(command, { version: "test" })(args).pipe(Effect.result, Effect.provide(NodeServices.layer)),
  )
  return { calls, result }
}
