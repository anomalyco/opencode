import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { Host } from "@opencode/plugin/host"
import { select, text } from "@clack/prompts"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { resolveConfigPath } from "../mcp/add"
import { Config } from "../../../config"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { pluginTarget, readPluginConfig, writePlugins } from "./config"

export default Runtime.handler(
  Commands.commands.plugin.commands.add,
  Effect.fn("cli.plugin.add")(function* (input) {
    if (input.local && input.global)
      return yield* Effect.fail(new Error("Provide either --local or --global, not both"))
    const supplied = Option.getOrUndefined(input.package)
    if (!supplied) yield* requireInteractive("Pass a plugin package when running without an interactive terminal")
    const targetPackage =
      supplied ??
      (yield* prompt(() =>
        text({
          message: "Which plugin would you like to add?",
          placeholder: "opencode-acme-plugin or github:acme/opencode-plugin",
          validate: (value) => (value?.trim() ? undefined : "Enter an npm registry or Git package specifier"),
        }),
      )).trim()
    if (!(yield* Effect.promise(() => Npm.isInstallablePackage(targetPackage))))
      return yield* Effect.fail(new Error("Plugin target must be an npm registry package or Git package specifier"))
    const npm = yield* Npm.Service
    const installed = yield* npm.add(targetPackage)
    const entrypoints = Host.resolve(installed)
    const target = configurationTarget(entrypoints.server, entrypoints.tui)
    if (!target)
      return yield* Effect.fail(new Error(`Plugin package has no server or TUI entrypoint: ${targetPackage}`))

    if (target === "server") {
      const global = yield* Global.Service
      const scope = input.local
        ? "local"
        : input.global || !process.stdin.isTTY || !process.stdout.isTTY
          ? "global"
          : yield* prompt(() =>
              select({
                message: "Where should this plugin be added?",
                options: [
                  { value: "local", label: "Project", hint: process.cwd() },
                  { value: "global", label: "Global", hint: "All projects" },
                ],
              }),
            )
      const configPath = yield* Effect.promise(() =>
        resolveConfigPath(scope === "local" ? process.cwd() : global.config),
      )
      const changed = yield* Effect.promise(() => writePluginConfig(configPath, targetPackage))
      process.stdout.write(
        changed
          ? `Plugin "${targetPackage}" installed and added to ${configPath}${EOL}`
          : `Plugin "${targetPackage}" is already configured in ${configPath}${EOL}`,
      )
      return
    }

    if (input.local)
      return yield* Effect.fail(new Error("TUI-only plugins require global CLI configuration; use --global instead"))
    const config = yield* Config.Service
    yield* config.update((draft) => {
      if (draft.plugins?.some((entry) => pluginTarget(entry) === targetPackage)) return
      draft.plugins = [...(draft.plugins ?? []), targetPackage]
    })
    process.stdout.write(`TUI plugin "${targetPackage}" installed and added to ${config.path}${EOL}`)
  }, handlePromptErrors),
)

export function configurationTarget(server?: string, tui?: string) {
  if (server) return "server" as const
  if (tui) return "tui" as const
}

export async function writePluginConfig(configPath: string, spec: string) {
  const config = await readPluginConfig(configPath)
  if (config.plugins.some((entry) => pluginTarget(entry) === spec)) return false
  await writePlugins(configPath, config.text, [...config.plugins, spec])
  return true
}
