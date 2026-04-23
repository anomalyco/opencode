import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { ProjectID } from "../../project/schema"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"

function localProject(directory: string): Project.Info & { vcs: "git" | undefined } {
  const now = Date.now()
  return {
    id: ProjectID.make(directory),
    time: {
      created: now,
      updated: now,
    },
    vcs: "git" as const,
  }
}

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
  },
  handler: async (args) => {
    if (args.refresh) {
      await ModelsDev.refresh()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    const dir = process.cwd()
    const project = localProject(dir)
    await Instance.provide({
      project,
      async fn() {
        const providers = await Provider.list()

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

        if (args.provider) {
          const provider = providers[args.provider]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          printModels(args.provider, args.verbose)
          return
        }

        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsOpencode = a.startsWith("opencode")
          const bIsOpencode = b.startsWith("opencode")
          if (aIsOpencode && !bIsOpencode) return -1
          if (!aIsOpencode && bIsOpencode) return 1
          return a.localeCompare(b)
        })

        for (const providerID of providerIDs) {
          printModels(providerID, args.verbose)
        }
      },
    })
  },
})
