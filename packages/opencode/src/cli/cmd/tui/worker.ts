import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isDev(),
  level: (() => {
    if (Installation.isDev()) return "DEBUG"
    return "INFO"
  })(),
})

const server = Server.listen({
  port: 4096,
  hostname: "127.0.0.1",
})

postMessage(JSON.stringify({ type: "ready", url: server.url }))
