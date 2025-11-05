import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import open from "open"

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) =>
    yargs
      .option("port", {
        alias: ["p"],
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const hostname = args.hostname
    const port = args.port
    const server = Server.listen({
      port,
      hostname,
    })
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(
      UI.Style.TEXT_INFO_BOLD + "  Web interface:    ",
      UI.Style.TEXT_NORMAL,
      server.url.toString(),
    )
    open(server.url.toString()).catch(() => {})
    await new Promise(() => {})
    await server.stop()
  },
})
