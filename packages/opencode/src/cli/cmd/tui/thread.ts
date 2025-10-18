import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import { upgrade } from "@/cli/upgrade"

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    yargs
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        alias: ["h"],
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  handler: async (args) => {
    upgrade()
    const worker = new Worker("./src/cli/cmd/tui/worker.ts")
    worker.onerror = console.error
    const client = Rpc.client<typeof rpc>(worker)
    process.on("uncaughtException", (e) => {
      console.error(e)
    })
    process.on("unhandledRejection", (e) => {
      console.error(e)
    })
    const server = await client.call("server", {
      port: args.port,
      hostname: args.hostname,
    })
    await tui({
      url: server.url,
      onExit: async () => {
        await client.call("shutdown", undefined)
      },
    })
  },
})
