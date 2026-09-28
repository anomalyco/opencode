import { describe, expect, test } from "bun:test"
import { layer } from "@effect/platform-node/NodeServices"
import { Cause, Effect, Exit } from "effect"
import { CliError, Command } from "effect/unstable/cli"
import { type CliArgs, command, Operands, shared, splitOperands, toCliArgs } from "../../src/cli/args"
import { ConfigError } from "../../src/contract"

// Parses argv with the real shared flag set and returns the CliArgs the handlers would see.
async function parse(argv: string[]) {
  const captured: CliArgs[] = []
  const probe = Command.make("oclite").pipe(
    Command.withSharedFlags(shared),
    Command.withHandler((flags) => Effect.sync(() => captured.push(toCliArgs(flags)))),
  )
  await Effect.runPromise(Command.runWith(probe, { version: "test" })(argv).pipe(Effect.provide(layer)))
  return captured[0]
}

function run(argv: string[]) {
  return Effect.runPromiseExit(
    Command.runWith(command, { version: "test" })(argv).pipe(Effect.provideService(Operands, []), Effect.provide(layer)),
  )
}

function failure(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) throw new Error("expected failure")
  return Cause.squash(exit.cause)
}

describe("cli args", () => {
  test("defaults", async () => {
    const args = await parse([])
    expect(args).toMatchObject({
      outputFormat: "text",
      mcpConfig: [],
      allowedTools: [],
      disallowedTools: [],
      strictMcpConfig: false,
      continue: false,
      noThinking: false,
    })
    expect(args.print).toBeUndefined()
    expect(args.model).toBeUndefined()
  })

  test("every SPEC §1 flag parses into CliArgs", async () => {
    const args = await parse([
      ...["-p", "list files", "--output-format", "stream-json", "--agent", "plan", "--model", "local/qwen"],
      ...["--profile", "local-min", "--mcp-config", "a.json", "--mcp-config", "b.json", "--strict-mcp-config"],
      ...["--allowed-tools", "read,bash(git *)", "--disallowed-tools", "write", "--permission-mode", "acceptEdits"],
      ...["--max-turns", "7", "--continue", "--resume", "ses_1", "--append-system-prompt", "be brief"],
      ...["--thinking", "off", "--no-thinking"],
    ])
    expect(args).toEqual({
      print: "list files",
      outputFormat: "stream-json",
      agent: "plan",
      model: "local/qwen",
      profile: "local-min",
      mcpConfig: ["a.json", "b.json"],
      strictMcpConfig: true,
      allowedTools: ["read,bash(git *)"],
      disallowedTools: ["write"],
      permissionMode: "acceptEdits",
      maxTurns: 7,
      continue: true,
      resume: "ses_1",
      appendSystemPrompt: "be brief",
      thinking: "off",
      noThinking: true,
    })
  })

  test("invalid choice is a usage error", async () => {
    const error = failure(await run(["--profile", "huge"]))
    expect(CliError.isCliError(error)).toBe(true)
  })

  test("unknown flag is a usage error", async () => {
    const error = failure(await run(["agents", "list", "--bogus"]))
    expect(CliError.isCliError(error)).toBe(true)
  })

  test.each([
    [["mcp", "serve", "--transport", "http", "--port", "5000"], "mcp serve --transport http: set OCLITE_MCP_TOKEN (clients send it as a Bearer token)"],
    [["mcp", "auth", "gh"], 'mcp auth: "gh" is not a configured remote MCP server'],
  ])("stub %j fails with ConfigError", async (argv, message) => {
    const error = failure(await run(argv))
    expect(error).toBeInstanceOf(ConfigError)
    expect(error).toMatchObject({ message })
  })

  test("splitOperands keeps everything after --", () => {
    expect(splitOperands(["mcp", "add", "fs", "--", "npx", "-y", "server"])).toEqual({
      argv: ["mcp", "add", "fs"],
      operands: ["npx", "-y", "server"],
    })
    expect(splitOperands(["agents", "list"])).toEqual({ argv: ["agents", "list"], operands: [] })
  })
})
