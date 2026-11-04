import { EOL } from "node:os"
import path from "node:path"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { Effect, Option, Schema } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { Host } from "@opencode/plugin/host"
import type { Form } from "@opencode/schema/form"
import { ConfigPlugin } from "@opencode/schema/config/plugin"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { resolveConfigPath } from "../mcp/add"
import { Config } from "../../../config"
import { handlePromptErrors, requireInteractive } from "../../../ui/prompt"
import { setupPlugin } from "./setup"

const decodeConfig = Schema.decodeUnknownOption(Schema.Struct({ plugins: Schema.optional(ConfigPlugin.Plugins) }))

export default Runtime.handler(
  Commands.commands.plugin.commands.add,
  Effect.fn("cli.plugin.add")(function* (input) {
    if (input.setup)
      yield* requireInteractive("Plugin setup requires an interactive terminal; omit --setup to install only")
    if (!(yield* Effect.promise(() => Npm.isInstallablePackage(input.package))))
      return yield* Effect.fail(new Error("Plugin target must be an npm registry package or Git package specifier"))
    const npm = yield* Npm.Service
    const installed = yield* npm.add(input.package)
    const target = configurationTarget(Host.resolve(installed))
    if (!target)
      return yield* Effect.fail(new Error(`Plugin package has no server, GUI, or TUI entrypoint: ${input.package}`))

    if (input.setup && target === "tui")
      return yield* Effect.fail(new Error("Setup is not yet supported for TUI-only plugins"))
    const options = input.setup ? yield* setupPlugin(installed.directory) : undefined

    if (target === "server") {
      const global = yield* Global.Service
      const configPath = yield* Effect.promise(() => resolveConfigPath(global.config))
      const changed = yield* Effect.promise(() => writePluginConfig(configPath, input.package, options))
      process.stdout.write(
        changed
          ? `Plugin "${input.package}" installed and added to ${configPath}${EOL}`
          : `Plugin "${input.package}" is already configured in ${configPath}${EOL}`,
      )
      return
    }

    const config = yield* Config.Service
    yield* config.update((draft) => {
      if (configurationIndex(draft.plugins, input.package) !== -1) return
      draft.plugins = [...(draft.plugins ?? []), input.package]
    })
    process.stdout.write(`TUI plugin "${input.package}" installed and added to ${config.path}${EOL}`)
  }, handlePromptErrors),
)

// The server lists packages with a server or GUI part, and the TUI loads their TUI parts from that list; the desktop
// app reads GUI parts only from the global opencode.json. Only a TUI-only package belongs in the TUI's own config.
export function configurationTarget(entrypoints: Host.Entrypoints) {
  if (entrypoints.server || entrypoints.gui) return "server" as const
  if (entrypoints.tui) return "tui" as const
}

export async function writePluginConfig(configPath: string, spec: string, options?: Form.Answer) {
  const text = await readFile(configPath, "utf8").catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "{}"
    throw error
  })
  const errors: ParseError[] = []
  const config = decodeConfig(parse(text, errors, { allowTrailingComma: true }))
  if (errors.length || Option.isNone(config)) throw new Error(`Invalid global configuration: ${configPath}`)
  const plugins = config.value.plugins
  const index = configurationIndex(plugins, spec)
  if (index !== -1 && options === undefined) return false
  const entry = plugins?.[index]
  const previous = typeof entry === "string" ? undefined : entry?.options
  // Setup answers override matching keys without removing unrelated options.
  const updatedEntry = options === undefined ? spec : { package: spec, options: { ...previous, ...options } }

  // -1 means not found: append at length; otherwise replace the existing entry.
  const updated = applyEdits(
    text,
    modify(text, ["plugins", index === -1 ? (plugins?.length ?? 0) : index], updatedEntry, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    }),
  )
  await mkdir(path.dirname(configPath), { recursive: true })
  const temporary = configPath + ".tmp"
  await writeFile(temporary, updated.endsWith("\n") ? updated : updated + "\n", { mode: 0o600 })
  await rename(temporary, configPath)
  return true
}

function configurationIndex(plugins: readonly ConfigPlugin.Plugin[] | undefined, spec: string) {
  return plugins?.findIndex((entry) => (typeof entry === "string" ? entry : entry.package) === spec) ?? -1
}
