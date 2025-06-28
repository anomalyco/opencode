import { App } from "../../app/app"
import { Provider } from "../../provider/provider"
import { cmd } from "./cmd"

export const ModelsCommand = cmd({
  command: "models",
  describe: "list all available models",
  handler: async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const providers = await Provider.list()

      for (const [providerID, provider] of Object.entries(providers)) {
        for (const modelID of Object.keys(provider.info.models)) {
          console.log(`${providerID}/${modelID}`)
        }
      }
    })
  },
})
