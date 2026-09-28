#!/usr/bin/env bun
// Startup-critical: only effect, the CLI framework and platform-node load here. Every command handler
// dynamic-imports its module (cli/args.ts), so `--help` never touches config, MCP or the model layer.
import { runMain } from "@effect/platform-node/NodeRuntime"
import { layer } from "@effect/platform-node/NodeServices"
import { Effect } from "effect"
import { CliError, Command } from "effect/unstable/cli"
import pkg from "../package.json" with { type: "json" }
import { command, Operands, splitOperands } from "./cli/args"
import { ConfigError } from "./contract"
import { redactText } from "./util/redact"

const input = splitOperands(process.argv.slice(2))

Command.runWith(command, { version: pkg.version })(input.argv).pipe(
  Effect.provideService(Operands, input.operands),
  Effect.catch((error) => Effect.sync(() => report(error))),
  Effect.provide(layer),
  runMain,
)

// Exit codes (SPEC §1): usage and config errors → 2; anything else → 1.
function report(error: unknown) {
  if (CliError.isCliError(error)) {
    // ShowHelp already printed the help text and its parse errors; a bare group command (`oclite mcp`) is not an error.
    if (error._tag === "ShowHelp" && error.errors.length === 0) return
    if (error._tag !== "ShowHelp") console.error(`oclite: ${redactText(error.message)}`)
    process.exitCode = 2
    return
  }
  if (error instanceof ConfigError) {
    console.error(`oclite: ${redactText(error.message)}`)
    process.exitCode = 2
    return
  }
  console.error(redactText(error instanceof Error ? (error.stack ?? error.message) : String(error)))
  process.exitCode = 1
}
