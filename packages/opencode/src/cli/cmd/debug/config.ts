import { EOL } from "os"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const ConfigCommand = cmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
      process.stdout.write(JSON.stringify(config, null, 2) + EOL)
    })
  },
})
