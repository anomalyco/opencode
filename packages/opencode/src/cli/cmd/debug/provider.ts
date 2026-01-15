import { EOL } from "os"
import { LocalProvider, type LocalModel } from "../../../provider/local"
import { cmd } from "../cmd"

export const ProviderCommand = cmd({
  command: "provider",
  describe: "probe local LLM providers",
  builder: (yargs) =>
    yargs.command({
      command: "probe <type> <url>",
      describe: "probe a local provider for loaded models",
      builder: (yargs) =>
        yargs
          .positional("type", {
            describe: "provider type",
            type: "string",
            choices: Object.values(LocalProvider).filter((v) => typeof v === "string") as LocalProvider[],
          })
          .positional("url", {
            describe: "provider URL",
            type: "string",
          }),
      async handler(args) {
        const type = args.type as LocalProvider
        const url = args.url as string
        const result = await LocalProvider.probe(type, url)
        process.stdout.write(JSON.stringify(result, null, 2) + EOL)
      },
    }),
  async handler() {},
})
