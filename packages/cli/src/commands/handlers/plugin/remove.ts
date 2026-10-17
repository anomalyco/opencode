import { EOL } from "node:os"
import { autocomplete, confirm, log } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Config } from "../../../config"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { configuredPlugins, pluginTarget, readPluginConfig, writePlugins } from "./config"

export default Runtime.handler(
  Commands.commands.plugin.commands.remove,
  Effect.fn("cli.plugin.remove")(function* (input) {
    if (input.local && input.global)
      return yield* Effect.fail(new Error("Provide either --local or --global, not both"))
    const target = Option.getOrUndefined(input.package)
    if (!target) yield* requireInteractive("Pass a plugin target when running without an interactive terminal")
    const global = yield* Global.Service
    const config = yield* Config.Service
    // Migrate legacy CLI configuration before enumerating its persisted plugin entries.
    if (!input.local) yield* config.get()
    const inventory = yield* Effect.tryPromise({
      try: () =>
        configuredPlugins({
          directory: process.cwd(),
          global: global.config,
          cli: config.path,
          scope: input.local ? "project" : input.global ? "global" : undefined,
        }),
      catch: (error) => error,
    })
    inventory.warnings.forEach((message) => log.warn(`Skipping config: ${message}`))
    const entries = inventory.entries.filter((entry) => !target || entry.target === target)
    if (!entries.length) {
      process.stdout.write(
        target
          ? `Plugin "${target}" is not configured in the selected scope${EOL}`
          : `No configured plugins found${EOL}`,
      )
      return
    }
    if (entries.length > 1)
      yield* requireInteractive(
        `Plugin target is ambiguous. Use --local or --global to narrow the selection, or edit its configuration file: ${entries.map((entry) => entry.path).join(", ")}`,
      )
    const selected =
      target && entries.length === 1
        ? entries[0]
        : yield* prompt(() =>
            autocomplete({
              message: "Which plugin would you like to remove?",
              maxItems: 10,
              options: entries.map((entry) => ({
                value: entry,
                label: `${entry.scope === "global" ? "Global" : entry.inherited ? "Inherited" : "Project"} · ${entry.target}`,
                hint: `${entry.runtime === "tui" ? "TUI · " : ""}${entry.path}`,
              })),
            }),
          )
    if (!input.yes && process.stdin.isTTY && process.stdout.isTTY) {
      const accepted = yield* prompt(() =>
        confirm({
          message: `Remove "${selected.target}" from ${selected.path}?${selected.scope === "global" ? " This affects all projects." : selected.inherited ? " This affects projects inheriting this file." : ""}`,
          initialValue: false,
        }),
      )
      if (!accepted) return
    }
    const removed =
      selected.runtime === "tui"
        ? yield* Effect.gen(function* () {
            yield* Effect.tryPromise({ try: () => readPluginConfig(selected.path), catch: (error) => error })
            yield* config.update((draft) => {
              draft.plugins = draft.plugins?.filter((entry) => pluginTarget(entry) !== selected.target)
            })
            return true
          })
        : yield* Effect.tryPromise({
            try: () => removePluginConfig(selected.path, selected.target),
            catch: (error) => error,
          })
    process.stdout.write(
      removed
        ? `Plugin "${selected.target}" removed from ${selected.path}${EOL}`
        : `Plugin "${selected.target}" is not configured in ${selected.path}${EOL}`,
    )
  }, handlePromptErrors),
)

export async function removePluginConfig(configPath: string, spec: string) {
  const config = await readPluginConfig(configPath)
  const plugins = config.plugins.filter((entry) => pluginTarget(entry) !== spec)
  if (plugins.length === config.plugins.length) return false
  await writePlugins(configPath, config.text, plugins)
  return true
}
