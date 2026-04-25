import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider"
import { ProviderID } from "../../provider/schema"
import { ModelsDev } from "../../provider"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"

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
      await ModelsDev.refresh(true)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const svc = yield* Provider.Service
            const providers = yield* svc.list()

            const print = (providerID: ProviderID, verbose?: boolean) => {
              const provider = providers[providerID]
              const sorted = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
              for (const [modelID, model] of sorted) {
                process.stdout.write(`${providerID}/${modelID}`)
                process.stdout.write(EOL)
                if (verbose) {
                  process.stdout.write(JSON.stringify(model, null, 2))
                  process.stdout.write(EOL)
                }
              }
            }

            if (args.provider) {
              const providerID = ProviderID.make(args.provider)
              const provider = providers[providerID]
              if (!provider) {
                yield* Effect.sync(() => UI.error(`Provider not found: ${args.provider}`))
                return
              }

              yield* Effect.sync(() => print(providerID, args.verbose))
              return
            }

            const ids = Object.keys(providers).sort((a, b) => {
              const aIsOpencode = a.startsWith("opencode")
              const bIsOpencode = b.startsWith("opencode")
              if (aIsOpencode && !bIsOpencode) return -1
              if (!aIsOpencode && bIsOpencode) return 1
              return a.localeCompare(b)
            })

            yield* Effect.sync(() => {
              for (const providerID of ids) {
                print(ProviderID.make(providerID), args.verbose)
              }
            })
          }),
        )
      },
    })
  },
})
