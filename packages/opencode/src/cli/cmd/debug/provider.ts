import { EOL } from "os"
import { LocalProvider, type LocalModel } from "../../../provider/local"
import { cmd } from "../cmd"

export const ProviderCommand = cmd({
  command: "provider",
  describe: "probe local LLM providers",
  builder: (yargs) =>
    yargs.command({
      command: "probe <url>",
      describe: "probe a local provider for loaded models",
      builder: (yargs) =>
        yargs
          .positional("url", {
            describe: "provider URL",
            type: "string",
          }),
      async handler(args) {
        const url = args.url as string

        const type = await LocalProvider.detect_provider(url);
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
    }),
  async handler() {},
})
