import { Provider } from "../../provider/provider"
import { Server } from "../../server/server"
import { Share } from "../../share/share"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    yargs
      .option("port", {
        alias: ["p"],
        type: "number",
        describe: "port to listen on",
        default: 4096,
      })
      .option("hostname", {
        alias: ["h"],
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const cwd = process.cwd()
    await bootstrap({ cwd }, async () => {
      const providers = await Provider.list()
      if (Object.keys(providers).length === 0) {
        return "needs_provider"
      }

      const hostname = args.hostname
      const port = args.port

      await Share.init()
      const server = Server.listen({
        port,
        hostname,
      })

      console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

      await new Promise(() => {})

      server.stop()
    })
  },
})
