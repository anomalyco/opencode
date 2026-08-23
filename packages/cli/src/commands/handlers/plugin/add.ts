import { EOL } from "node:os"
import path from "node:path"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { resolveConfigPath } from "../mcp/add"
import { Config } from "../../../config"

export default Runtime.handler(
  Commands.commands.plugin.commands.add,
  Effect.fn("cli.plugin.add")(function* (input) {
    if (!(yield* Effect.promise(() => Npm.isRegistryPackage(input.package))))
      return yield* Effect.fail(
        new Error("Plugin target must be an npm registry package name, version, tag, or semver range"),
      )
    const npm = yield* Npm.Service
    const installed = yield* npm.add(input.package, { subpaths: ["server", ""] })
    const tui = yield* npm.resolve(input.package, { subpaths: ["tui"] })
    const target = configurationTarget(installed.entrypoint, tui.entrypoint)
    if (!target)
      return yield* Effect.fail(new Error(`Plugin package has no server or TUI entrypoint: ${input.package}`))

    if (target === "server") {
      const global = yield* Global.Service
      const configPath = yield* Effect.promise(() => resolveConfigPath(global.config))
      const changed = yield* Effect.promise(() => writePluginConfig(configPath, input.package))
      process.stdout.write(
        changed
          ? `Plugin "${input.package}" installed and added to ${configPath}${EOL}`
          : `Plugin "${input.package}" is already configured in ${configPath}${EOL}`,
      )
      return
    }

    const config = yield* Config.Service
    yield* config.update((draft) => {
      if (configured(draft.plugins, input.package)) return
      draft.plugins = [...(draft.plugins ?? []), input.package]
    })
    process.stdout.write(`TUI plugin "${input.package}" installed and added to ${config.path}${EOL}`)
  }),
)

export function configurationTarget(server?: string, tui?: string) {
  if (server) return "server" as const
  if (tui) return "tui" as const
}

export async function writePluginConfig(configPath: string, spec: string) {
  const text = await readFile(configPath, "utf8").catch((error) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "{}"
    throw error
  })
  const errors: ParseError[] = []
  const config: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof config !== "object" || config === null || Array.isArray(config))
    throw new Error(`Invalid global configuration: ${configPath}`)
  const plugins = "plugins" in config ? config.plugins : undefined
  if (plugins !== undefined && !Array.isArray(plugins)) throw new Error(`Invalid plugins configuration: ${configPath}`)
  if (configured(plugins, spec)) return false

  const updated = applyEdits(
    text,
    modify(text, ["plugins"], [...(plugins ?? []), spec], { formattingOptions: { tabSize: 2, insertSpaces: true } }),
  )
  await mkdir(path.dirname(configPath), { recursive: true })
  const temporary = configPath + ".tmp"
  await writeFile(temporary, updated.endsWith("\n") ? updated : updated + "\n", { mode: 0o600 })
  await rename(temporary, configPath)
  return true
}

function configured(plugins: readonly unknown[] | undefined, spec: string) {
  return plugins?.some(
    (entry) =>
      entry === spec || (typeof entry === "object" && entry !== null && "package" in entry && entry.package === spec),
  )
}
