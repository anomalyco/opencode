import { cmd } from "./cmd"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"

const FILENAME = "preferences.md"

const DEFAULT_CONTENT = `# User Preferences

<!-- Edit this file to customize how the AI assistant interacts with you. -->
<!-- This file is in Markdown format and will be included in the system prompt. -->

## Communication

- Language: Respond in the same language the user uses
- Verbosity: Concise by default, detailed when asked

## Code Style

- Follow existing project conventions
- Prefer idiomatic patterns for each language

## Behavior

- Ask for clarification when requirements are ambiguous
- Explain trade-offs when multiple approaches exist
`

const PreferencePathCommand = cmd({
  command: "path",
  describe: "show the path to the preferences file",
  handler: () => {
    console.log(path.join(Global.Path.config, FILENAME))
  },
})

const PreferenceShowCommand = effectCmd({
  command: "show",
  describe: "show the contents of the preferences file",
  instance: false,
  handler: Effect.fn("Cli.preference.show")(function* () {
    const filePath = path.join(Global.Path.config, FILENAME)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, "utf-8")).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (content === undefined) {
      console.log("(preferences file does not exist yet)")
      return
    }
    console.log(content)
  }),
})

const PreferenceEditCommand = effectCmd({
  command: "edit",
  describe: "open the preferences file in your default editor",
  instance: false,
  handler: Effect.fn("Cli.preference.edit")(function* () {
    const filePath = path.join(Global.Path.config, FILENAME)
    const exists = yield* Effect.tryPromise(() => fs.access(filePath).then(() => true).catch(() => false))
    if (!exists) {
      yield* Effect.tryPromise(() => fs.writeFile(filePath, DEFAULT_CONTENT, "utf-8"))
      console.log(`Created preferences file: ${filePath}`)
    }
    const editor = process.env.EDITOR ?? process.env.VISUAL ?? (process.platform === "win32" ? "notepad" : "vi")
    const { spawn } = yield* Effect.tryPromise(() => import("child_process"))
    const child = spawn(editor, [filePath], { stdio: "inherit" })
    yield* Effect.async<void, Error>((resume: (effect: Effect.Effect<void, Error>) => void) => {
      child.on("exit", () => resume(Effect.void))
      child.on("error", (error: Error) => resume(Effect.fail(error)))
    }).pipe(Effect.mapError((error: Error) => new Error(`Failed to open editor: ${error.message}`)))
    console.log(`Preferences saved to: ${filePath}`)
    console.log("Changes will take effect in your next session.")
  }),
})

const PreferenceResetCommand = effectCmd({
  command: "reset",
  describe: "reset the preferences file to default content",
  instance: false,
  handler: Effect.fn("Cli.preference.reset")(function* () {
    const filePath = path.join(Global.Path.config, FILENAME)
    yield* Effect.tryPromise(() => fs.writeFile(filePath, DEFAULT_CONTENT, "utf-8")).pipe(
      Effect.mapError((error: Error) => new Error(`Failed to write preferences: ${error.message}`)),
    )
    console.log(`Preferences file reset to default: ${filePath}`)
  }),
})

export const PreferenceCommand = cmd({
  command: "preference <subcommand>",
  describe: "manage user preferences (stored as Markdown)",
  builder: (yargs) =>
    yargs
      .command(PreferencePathCommand)
      .command(PreferenceShowCommand)
      .command(PreferenceEditCommand)
      .command(PreferenceResetCommand)
      .demandCommand(1, "Please specify a subcommand"),
  handler: () => {},
})
