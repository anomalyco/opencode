import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"

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
  handler: async () => {
    const worker = new Worker("./src/cli/cmd/tui/worker.ts")
    worker.onerror = console.error
    const server = await new Promise<any>((resolve) => {
      worker.onmessage = async (evt) => {
        resolve(JSON.parse(evt.data))
      }
    })
    await tui({
      url: server.url,
      onExit: async () => {
        await new Promise((resolve) => {
          worker.onmessage = resolve
          worker.postMessage(JSON.stringify({ type: "shutdown" }))
        })
      },
    })
  },
})
