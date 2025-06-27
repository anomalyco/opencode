import { App } from "../../app/app"
import { Provider } from "../../provider/provider"
import { Config } from "../../config/config"
import { UI } from "../ui"
import { cmd } from "./cmd"
import type { Argv } from "yargs"

export const ProviderCommand = cmd({
  command: "provider",
  describe: "manage providers",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        "list",
        "list all available providers",
        {},
        async () => {
          await App.provide({ cwd: process.cwd() }, async () => {
            const providers = await Provider.list()
            const config = await Config.get()
            const currentModel = config.model ? Provider.parseModel(config.model) : null

            UI.println(UI.Style.TEXT_NORMAL_BOLD + "Available Providers:")
            UI.empty()

            for (const [providerID, provider] of Object.entries(providers)) {
              const modelCount = Object.keys(provider.info.models).length
              const isCurrent = currentModel?.providerID === providerID
              
              const prefix = isCurrent ? "* " : "  "
              const style = isCurrent ? UI.Style.TEXT_SUCCESS_BOLD : UI.Style.TEXT_NORMAL
              
              UI.println(
                style + prefix + providerID,
                UI.Style.TEXT_DIM + ` (${modelCount} models, ${provider.source})`
              )
            }
          })
        }
      )
      .command(
        "current",
        "show the current provider and model",
        {},
        async () => {
          await App.provide({ cwd: process.cwd() }, async () => {
            const config = await Config.get()
            
            if (!config.model) {
              const defaultModel = await Provider.defaultModel()
              UI.println(
                UI.Style.TEXT_NORMAL_BOLD + "Current: ",
                UI.Style.TEXT_NORMAL + `${defaultModel.providerID}/${defaultModel.modelID}`,
                UI.Style.TEXT_DIM + " (default)"
              )
            } else {
              const { providerID, modelID } = Provider.parseModel(config.model)
              UI.println(
                UI.Style.TEXT_NORMAL_BOLD + "Current: ",
                UI.Style.TEXT_NORMAL + `${providerID}/${modelID}`,
                UI.Style.TEXT_DIM + " (configured)"
              )
            }
          })
        }
      )
      .command(
        "set <provider>",
        "set the default provider",
        (yargs) => {
          return yargs
            .positional("provider", {
              type: "string",
              describe: "provider ID to set as default",
              demandOption: true,
            })
            .option("model", {
              alias: "m",
              type: "string",
              describe: "specific model to use with this provider",
            })
        },
        async (args) => {
          await App.provide({ cwd: process.cwd() }, async () => {
            const providers = await Provider.list()
            const provider = providers[args.provider]
            
            if (!provider) {
              UI.error(`Provider "${args.provider}" not found`)
              UI.empty()
              UI.println("Available providers:")
              for (const providerID of Object.keys(providers)) {
                UI.println("  " + providerID)
              }
              return
            }

            // Find the model to use
            let modelID: string
            if (args.model) {
              // Check if the specified model exists
              if (!provider.info.models[args.model]) {
                UI.error(`Model "${args.model}" not found for provider "${args.provider}"`)
                UI.empty()
                UI.println("Available models:")
                for (const model of Object.keys(provider.info.models)) {
                  UI.println("  " + model)
                }
                return
              }
              modelID = args.model
            } else {
              // Use the default model for this provider
              const models = Provider.sort(Object.values(provider.info.models))
              if (models.length === 0) {
                UI.error(`No models available for provider "${args.provider}"`)
                return
              }
              modelID = models[0].id
            }

            // Update the global config
            const configPath = await Config.global().then(() => 
              App.info().path.config + "/config.json"
            )
            
            const currentConfig = await Config.global()
            currentConfig.model = `${args.provider}/${modelID}`
            
            await Bun.write(configPath, JSON.stringify(currentConfig, null, 2))
            
            UI.println(
              UI.Style.TEXT_SUCCESS_BOLD + "Success: ",
              UI.Style.TEXT_NORMAL + `Default provider set to: ${args.provider}/${modelID}`
            )
          })
        }
      )
      .demandCommand(1, "You must specify a subcommand")
  },
  handler: () => {
    // This is handled by subcommands
  },
})