import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { UI } from "../../ui"

/** Resolve the editor command line: $EDITOR, falling back to $VISUAL. */
export function editor() {
  const value = process.env.EDITOR?.trim() || process.env.VISUAL?.trim()
  if (!value) return undefined
  return value
}

export const EditCommand = effectCmd({
  command: "edit",
  describe: "open the global config in $EDITOR",
  instance: false,
  handler: Effect.fn("Cli.config.edit")(function* () {
    const command = editor()
    if (!command) return yield* fail("No editor configured. Set $EDITOR (or $VISUAL) and try again.")
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const file = Config.globalConfigFile()
    const exists = yield* Effect.promise(() => Bun.file(file).exists())
    if (!exists) {
      yield* Effect.promise(() =>
        Bun.write(file, JSON.stringify({ $schema: "https://bolt.ai/config.json" }, null, 2) + "\n"),
      )
    }
    // `$1` keeps the file path intact even when $EDITOR carries flags (e.g. "code --wait").
    const proc = Bun.spawn(["sh", "-c", `${command} "$1"`, "sh", file], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    const code = yield* Effect.promise(() => proc.exited)
    if (code !== 0) return yield* fail(`Editor exited with code ${code}`)
    UI.println(`Edited ${file}`)
  }),
})
