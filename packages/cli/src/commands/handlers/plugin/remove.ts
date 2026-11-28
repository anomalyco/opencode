import { EOL } from "node:os"
import { readFile, rename, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Config } from "../../../config"
import { resolveConfigPath } from "../mcp/add"

export default Runtime.handler(
  Commands.commands.plugin.commands.remove,
  Effect.fn("cli.plugin.remove")(function* (input) {
    const global = yield* Global.Service
    const configPath = yield* Effect.promise(() => resolveConfigPath(global.config))
    const server = yield* Effect.promise(() => removePluginConfig(configPath, input.package))
    const config = yield* Config.Service
    const info = yield* config.get()
    const tui = configured(info.plugins, input.package)
    if (tui)
      yield* config.update((draft) => {
        draft.plugins = draft.plugins?.filter((entry) => !matches(entry, input.package))
      })

    const removed = [server ? configPath : undefined, tui ? config.path : undefined].filter(
      (file) => file !== undefined,
    )
    process.stdout.write(
      removed.length
        ? `Plugin "${input.package}" removed from ${removed.join(", ")}${EOL}`
        : `Plugin "${input.package}" is not configured${EOL}`,
    )
  }),
)

export async function removePluginConfig(configPath: string, spec: string) {
  const text = await readFile(configPath, "utf8").catch((error) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (text === undefined) return false
  const errors: ParseError[] = []
  const config: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof config !== "object" || config === null || Array.isArray(config))
    throw new Error(`Invalid global configuration: ${configPath}`)
  const plugins = "plugins" in config ? config.plugins : undefined
  if (plugins !== undefined && !Array.isArray(plugins)) throw new Error(`Invalid plugins configuration: ${configPath}`)
  // The config loader combines native plugins with the supported legacy plugin list.
  const legacy = "plugin" in config && Array.isArray(config.plugin) ? config.plugin : undefined
  const edits = [
    { key: "plugins", before: plugins, after: plugins?.filter((entry) => !matches(entry, spec)) },
    { key: "plugin", before: legacy, after: legacy?.filter((entry) => !matchesLegacy(entry, spec)) },
  ].filter((entry) => entry.before?.length !== entry.after?.length)
  if (!edits.length) return false

  const updated = edits.reduce(
    (current, edit) =>
      applyEdits(
        current,
        modify(current, [edit.key], edit.after, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
      ),
    text,
  )
  const temporary = configPath + ".tmp"
  await writeFile(temporary, updated.endsWith("\n") ? updated : updated + "\n", { mode: 0o600 })
  await rename(temporary, configPath)
  return true
}

function configured(plugins: readonly unknown[] | undefined, spec: string) {
  return plugins?.some((entry) => matches(entry, spec)) ?? false
}

function matches(entry: unknown, spec: string) {
  return entry === spec || (typeof entry === "object" && entry !== null && "package" in entry && entry.package === spec)
}

function matchesLegacy(entry: unknown, spec: string) {
  return (
    entry === spec ||
    (Array.isArray(entry) &&
      entry.length === 2 &&
      entry[0] === spec &&
      typeof entry[1] === "object" &&
      entry[1] !== null &&
      !Array.isArray(entry[1]))
  )
}
