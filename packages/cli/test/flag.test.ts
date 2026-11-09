import { expect, test } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Option } from "effect"
import { Argument, CliOutput, Command, Flag } from "effect/cli"
import { CliFlag } from "../src/framework/flag"

const params = {
  worktree: CliFlag.optionalValue("worktree", "name").pipe(
    Flag.withAlias("w"),
    Flag.withDescription("Start in a new git worktree"),
  ),
  model: Flag.String("model").pipe(Flag.withAlias("m"), Flag.optional),
  fork: Flag.Boolean("fork").pipe(Flag.withDefault(false)),
  message: Argument.String("message").pipe(Argument.variadic()),
}

function parse(args: ReadonlyArray<string>) {
  const received: unknown[] = []
  const command = Command.make("run", params).pipe(
    Command.withHandler((input) =>
      Effect.sync(() => void received.push({ worktree: input.worktree, message: input.message, model: input.model })),
    ),
  )
  return Effect.runPromise(
    Command.runWith(command, { version: "test", renderErrors: false })(args).pipe(
      Effect.exit,
      Effect.provide(NodeServices.layer),
      Effect.map((exit) => ({ exit, input: received[0] })),
    ),
  )
}

test.each([
  { args: [], worktree: Option.none(), message: [] },
  { args: ["--worktree"], worktree: Option.some(true), message: [] },
  { args: ["-w"], worktree: Option.some(true), message: [] },
  { args: ["--worktree="], worktree: Option.some(true), message: [] },
  { args: ["--worktree=feature"], worktree: Option.some("feature"), message: [] },
  { args: ["-w=feature"], worktree: Option.some("feature"), message: [] },
  { args: ["-w", "fix it"], worktree: Option.some(true), message: ["fix it"] },
  { args: ["--worktree", "fix", "it"], worktree: Option.some(true), message: ["fix", "it"] },
  { args: ["fix", "-w", "it"], worktree: Option.some(true), message: ["fix", "it"] },
  { args: ["--worktree=feature", "fix", "it"], worktree: Option.some("feature"), message: ["fix", "it"] },
  { args: ["-w", "--", "-w", "fix"], worktree: Option.some(true), message: ["-w", "fix"] },
  { args: ["--", "--worktree=feature"], worktree: Option.none(), message: ["--worktree=feature"] },
])("parses $args", async ({ args, worktree, message }) => {
  const result = await parse(args)
  expect(Exit.isSuccess(result.exit)).toBe(true)
  expect(result.input).toEqual({ worktree, message, model: Option.none() })
})

test("leaves the next flag and its value alone", async () => {
  const result = await parse(["-w", "--model", "openai/gpt", "--fork", "hi"])
  expect(Exit.isSuccess(result.exit)).toBe(true)
  expect(result.input).toEqual({ worktree: Option.some(true), message: ["hi"], model: Option.some("openai/gpt") })
})

// Matches every other single-value flag, where `--model a --model b` is rejected.
test.each([
  { args: ["-w", "--worktree=feature"] },
  { args: ["--worktree=feature", "-w"] },
  { args: ["--model", "a", "--model", "b"] },
])("rejects repeated flags: $args", async ({ args }) => {
  const result = await parse(args)
  expect(Exit.isFailure(result.exit)).toBe(true)
  expect(result.input).toBeUndefined()
})

test("renders the value as optional in help", async () => {
  const pages: string[] = []
  const formatter = CliOutput.defaultFormatter({ colors: false })
  const command = Command.make("run", params).pipe(Command.withHandler(() => Effect.void))
  await Effect.runPromise(
    Command.runWith(command, { version: "test" })(["--help"]).pipe(
      Effect.provide(
        CliOutput.layer({
          ...formatter,
          formatHelpDoc: (doc) => {
            const page = formatter.formatHelpDoc(doc)
            pages.push(page)
            return page
          },
        }),
      ),
      Effect.provide(NodeServices.layer),
    ),
  )
  expect(pages.join("\n")).toMatch(/--worktree, -w \[=name\]\s+Start in a new git worktree/)
})
