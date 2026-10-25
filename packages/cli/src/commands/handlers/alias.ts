import { existsSync } from "fs"
import { Effect } from "effect"
import { applyEdits, modify } from "jsonc-parser"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const NAME = /^[A-Za-z0-9][\w-]*$/

export const AliasCommand = effectCmd({
  command: "alias [entry]",
  describe: 'list aliases, show one, or set one with name="expansion"',
  builder: (yargs) =>
    yargs
      .positional("entry", {
        type: "string",
        describe: 'alias name to show, or name="run --agent reviewer ..." to set',
      })
      .option("rm", { type: "boolean", default: false, describe: "remove the alias" })
      .example("bolt alias deploy-check=\"run --agent reviewer 'audit the deploy diff'\"", "persist an alias")
      .example("bolt alias", "list aliases")
      .example("bolt alias --rm deploy-check", "remove an alias"),
  instance: false,
  handler: Effect.fn("Cli.alias")(function* (args) {
    const { CliAlias } = yield* Effect.promise(() => import("../alias"))
    const known = CliAlias.load(process.cwd())

    if (!args.entry) {
      if (args.rm) return yield* fail("Pass the alias name to remove, e.g. bolt alias --rm deploy-check")
      const entries = Object.entries(known).sort((a, b) => a[0].localeCompare(b[0]))
      if (!entries.length) {
        UI.println('No aliases defined. Set one with: bolt alias name="run ..."')
        return
      }
      for (const [name, value] of entries) UI.println(`${name}=${JSON.stringify(value)}`)
      return
    }

    const split = args.entry.indexOf("=")
    const name = split === -1 ? args.entry : args.entry.slice(0, split)
    if (!NAME.test(name)) return yield* fail(`Invalid alias name "${name}"`)

    if (args.rm) {
      if (known[name] === undefined) return yield* fail(`No alias named "${name}"`)
      yield* write(name, undefined)
      UI.println(`Removed alias ${name}`)
      return
    }

    if (split === -1) {
      if (known[name] === undefined) return yield* fail(`No alias named "${name}"`)
      UI.println(`${name}=${JSON.stringify(known[name])}`)
      return
    }

    const value = args.entry.slice(split + 1)
    if (!value.trim()) return yield* fail("Alias expansion cannot be empty")
    if (name === "alias") return yield* fail('"alias" cannot be aliased')
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    yield* write(name, value)
    UI.println(`${name}=${JSON.stringify(value)}`)
    UI.println(`Saved to ${Config.globalConfigFile()}`)
  }),
})

// Persist to the global config file with jsonc-parser so comments survive; undefined removes.
const write = Effect.fnUntraced(function* (name: string, value: string | undefined) {
  const { Config } = yield* Effect.promise(() => import("@/config/config"))
  const target = Config.globalConfigFile()
  const text = existsSync(target) ? yield* Effect.promise(() => Bun.file(target).text()) : ""
  const current = text.trim() ? text : "{}"
  const updated = applyEdits(
    current,
    modify(current, ["alias", name], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
  )
  yield* Effect.promise(() => Bun.write(target, updated))
})
