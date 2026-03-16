import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Global } from "../../global"
import { modify, applyEdits } from "jsonc-parser"
import { resolveConfigPath } from "./mcp"

async function updateDisabledPlugins(plugins: string[], configPath: string) {
  const file = Bun.file(configPath)

  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
  }

  const edits = modify(text, ["disabled_plugins"], plugins, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Bun.write(configPath, result)
}

export const PluginCommand = cmd({
  command: "plugin",
  describe: "manage plugins",
  builder: (yargs) =>
    yargs.command(PluginListCommand).command(PluginDisableCommand).command(PluginEnableCommand).demandCommand(),
  async handler() {},
})

export const PluginListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all configured plugins and their status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Plugins")

        const config = await Config.get()
        const plugins = config.plugin ?? []
        const disabled = new Set(config.disabled_plugins ?? [])

        if (plugins.length === 0) {
          prompts.log.warn("No plugins configured")
          prompts.outro("Add plugins in opencode.json or via npm install")
          return
        }

        for (const plugin of plugins) {
          const name = Config.getPluginName(plugin)
          const isDisabled = disabled.has(name)
          const icon = isDisabled ? "○" : "✓"
          const status = isDisabled ? "disabled" : "enabled"
          prompts.log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${status}\n    ${UI.Style.TEXT_DIM}${plugin}`)
        }

        const enabledCount = plugins.filter((p) => !disabled.has(Config.getPluginName(p))).length
        prompts.outro(`${enabledCount}/${plugins.length} plugin(s) enabled`)
      },
    })
  },
})

export const PluginDisableCommand = cmd({
  command: "disable <name>",
  describe: "disable a plugin",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the plugin to disable",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Disable Plugin")

        const config = await Config.get()
        const plugins = config.plugin ?? []
        const pluginName = args.name

        if (plugins.length === 0) {
          prompts.log.warn("No plugins configured")
          prompts.outro("Done")
          return
        }

        const pluginEntry = plugins.find((p) => Config.getPluginName(p) === pluginName)
        if (!pluginEntry) {
          prompts.log.error(`Plugin not found: ${pluginName}`)
          prompts.outro("Done")
          return
        }

        const disabled = config.disabled_plugins ?? []
        if (disabled.includes(pluginName)) {
          prompts.log.warn(`Plugin "${pluginName}" is already disabled`)
          prompts.outro("Done")
          return
        }

        const [projectConfigPath, globalConfigPath] = await Promise.all([
          resolveConfigPath(Instance.worktree),
          resolveConfigPath(Global.Path.config, true),
        ])

        const currentProject = Instance.project
        const configPath = currentProject.vcs === "git" ? projectConfigPath : globalConfigPath
        const nextDisabled = [...disabled, pluginName]
        await updateDisabledPlugins(nextDisabled, configPath)

        prompts.log.success(`Plugin "${pluginName}" disabled`)
        prompts.outro("Done")
      },
    })
  },
})

export const PluginEnableCommand = cmd({
  command: "enable <name>",
  describe: "enable a previously disabled plugin",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the plugin to enable",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Enable Plugin")

        const config = await Config.get()
        const disabled = config.disabled_plugins ?? []
        const pluginName = args.name

        if (!disabled.includes(pluginName)) {
          prompts.log.warn(`Plugin "${pluginName}" is not disabled`)
          prompts.outro("Done")
          return
        }

        const [projectConfigPath, globalConfigPath] = await Promise.all([
          resolveConfigPath(Instance.worktree),
          resolveConfigPath(Global.Path.config, true),
        ])

        const currentProject = Instance.project
        const configPath = currentProject.vcs === "git" ? projectConfigPath : globalConfigPath
        const nextDisabled = disabled.filter((p) => p !== pluginName)
        await updateDisabledPlugins(nextDisabled, configPath)

        prompts.log.success(`Plugin "${pluginName}" enabled`)
        prompts.outro("Done")
      },
    })
  },
})
