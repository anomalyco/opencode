import { Server } from "../../server/server"
import { Config } from "../../config/config"
import { AppRuntime } from "../../effect/app-runtime"
import { resolveLocale, t } from "../../i18n"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { bootstrap } from "../bootstrap"

export function serveWarning(locale: ReturnType<typeof resolveLocale>) {
  return t(locale, "cli.serve.warning_unsecured")
}

export function serveListening(locale: ReturnType<typeof resolveLocale>, hostname: string, port: number) {
  return t(locale, "cli.serve.listening", { hostname, port })
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const locale = await bootstrap(process.cwd(), async () => {
      const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
      return resolveLocale(config.locale)
    })
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log(serveWarning(locale))
    }
    const opts = await resolveNetworkOptions(args)
    const server = await Server.listen(opts)
    console.log(serveListening(locale, server.hostname, server.port))

    await new Promise(() => {})
    await server.stop()
  },
})
