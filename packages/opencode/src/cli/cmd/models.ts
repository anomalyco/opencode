import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["text", "json"] as const,
        default: "text",
      })
  },
  handler: async (args) => {
    if (args.refresh) {
      await ModelsDev.refresh()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const providers = await Provider.list()

        function collectModels(providerID: string) {
          const provider = providers[providerID]
          return Object.entries(provider.models)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([modelID, model]) => ({
              ...model,
              id: `${providerID}/${modelID}`,
              provider: providerID,
              model: modelID,
            }))
        }

        function printModels(providerID: string, verbose?: boolean) {
          const provider = providers[providerID]
          const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        const targetProviderIDs = args.provider ? [args.provider] : Object.keys(providers).sort((a, b) => {
          const aIsOpencode = a.startsWith("opencode")
          const bIsOpencode = b.startsWith("opencode")
          if (aIsOpencode && !bIsOpencode) return -1
          if (!aIsOpencode && bIsOpencode) return 1
          return a.localeCompare(b)
        })

        if (args.provider && !providers[args.provider]) {
          UI.error(`Provider not found: ${args.provider}`)
          return
        }

        if (args.format === "json") {
          const models = targetProviderIDs.flatMap(collectModels)
          process.stdout.write(JSON.stringify(models, null, 2))
          process.stdout.write(EOL)
          return
        }

        for (const providerID of targetProviderIDs) {
          printModels(providerID, args.verbose)
        }
      },
    })
  },
})
