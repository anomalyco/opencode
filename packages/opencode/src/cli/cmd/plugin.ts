import { cmd } from "./cmd"
import { App } from "../../app/app"
import { Config } from "../../config/config"
import { UI } from "../ui"

function readConfig(configs: Map<string, Config.Info>): [string, Config.Info] {
  let target = Array.from(configs.keys())[0]
  for (const [key, config] of configs.entries()) {
    if (config.plugin === undefined) continue
    // find first config w/ plugin
    if (config.plugin.length > 0) {
      target = key
      break
    }
    target = key
  }
  return [target, configs.get(target) ?? {}]
}

const PluginInstallCommand = cmd({
  command: "install <package..>",
  aliases: ["i"],
  describe: "install plugin(s)",
  builder: (yargs) => {
    return yargs
      .positional("package", {
        type: "string",
        array: true,
        demandOption: true,
        description: "plugin(s) to install",
      })
      .option("global", {
        type: "boolean",
        default: false,
        alias: ["g"],
        description: "install the plugin globally",
      })
  },
  async handler(args) {
    await App.provide({ cwd: process.cwd() }, async (app) => {
      const configs = await Config.loadFiles(args["global"], app)
      const [target, config] = readConfig(configs)
      console.log(JSON.stringify(args))
      const packages = args["package"].filter((pkg: string) => !config.plugin?.includes(pkg))
      if (packages.length === 0) {
        UI.error("No plugins to install")
        return
      }
      if (config.plugin) {
        config.plugin.push(...packages)
      } else {
        config.plugin = packages
      }
      await Config.write(target, config)

      UI.println(`${packages.length} package${packages.length !== 1 ? "s" : ""} installed`)
    })
  },
})

const PluginUninstallCommand = cmd({
  command: "uninstall <package..>",
  describe: "uninstall plugin(s)",
  builder: (yargs) => {
    return yargs
      .positional("package", {
        type: "string",
        array: true,
        demandOption: true,
        description: "plugin(s) to install",
      })
      .option("global", {
        type: "boolean",
        default: false,
        alias: ["g"],
        description: "install the plugin globally",
      })
  },
  async handler(args) {
    await App.provide({ cwd: process.cwd() }, async (app) => {
      const configs = await Config.loadFiles(args["global"], app)
      const [target, config] = readConfig(configs)
      const packagesToRemove = (args["package"] as string[]).filter((pkg: string) => config.plugin?.includes(pkg))
      config.plugin = config.plugin?.filter((pkg) => !(args["package"] as string[]).includes(pkg)) || []
      await Config.write(target, config)

      UI.println(`${packagesToRemove.length} package${packagesToRemove.length !== 1 ? "s" : ""} uninstalled`)
    })
  },
})

export const PluginCommand = cmd({
  command: "plugin",
  describe: "manage plugins",
  builder: (yargs) => yargs.command(PluginInstallCommand).command(PluginUninstallCommand).demandCommand(),
  async handler() {},
})
