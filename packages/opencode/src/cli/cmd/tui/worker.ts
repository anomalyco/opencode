import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

upgrade()

let server: Bun.Server<undefined>
export const rpc = {
  async server(input: { port: number; hostname: string }) {
    if (server) await server.stop(true)
    try {
      server = Server.listen(input)
      return {
        url: server.url.toString(),
      }
    } catch (e) {
      console.error(e)
      throw e
    }
  },
  async shutdown() {
    await Instance.disposeAll()
    await server.stop(true)
  },
}

Rpc.listen(rpc)
