import { ProviderModelDetection } from "@/provider/model-detection"
import { LocalProvider } from "@/provider/local"
import { cmd } from "../cmd"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"

export const ProviderCommand = cmd({
  command: "provider",
  describe: "Provider debugging utilities",
  builder: (yargs) => yargs.command(ProviderDetectCommand).command(ProviderProbeCommand).demandCommand(),
  async handler() {},
})

export const ProviderDetectCommand = cmd({
  command: "detect <providerId>",
  describe: "probe models by provider ID",
  builder: (yargs) =>
    yargs.positional("providerId", {
      describe: "provider ID",
      type: "string",
    }),
  async handler(args) {
    const providerId = args.providerId as string

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const provider = await Provider.getProvider(providerId)
        if (!provider) {
          console.error(`Provider with ID '${providerId}' not found.`)
          process.exit(1)
        }

        console.log(`Detecting models for provider ID: ${providerId}`)
        const detectionResult = await ProviderModelDetection.detect(provider)
        if (!detectionResult) {
          console.log("No models detected.")
          return
        }

        console.log(`Detected ${detectionResult.length} models:`)
        console.log(JSON.stringify(detectionResult, null, 2))
      },
    })
  },
})

export const ProviderProbeCommand = cmd({
  command: "probe <url>",
  describe: "probe local provider by URL",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "provider URL",
      type: "string",
    }),
  async handler(args) {
    const url = args.url as string

    const type = await LocalProvider.detect_provider(url)
    if (!type) {
      console.error(`No supported local provider detected at URL: ${url}`)
      process.exit(1)
    }

    console.log(`Detected provider type: ${type} at URL: ${url}`)
    const result = await LocalProvider.probe_provider(type, url)

    if (result.length === 0) {
      console.log("No loaded models found")
      return
    }

    console.log(`Found ${result.length} loaded models:`)
    console.log(JSON.stringify(result, null, 2))
  },
})
