import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isDev(),
  level: (() => {
    if (Installation.isDev()) return "DEBUG"
    return "INFO"
  })(),
})

const server = Server.listen({
  port: 0,
  hostname: "127.0.0.1",
})

postMessage(JSON.stringify({ type: "ready", url: server.url }))

onmessage = async (evt) => {
  const parsed = JSON.parse(evt.data)
  if (parsed.type === "shutdown") {
    await Instance.disposeAll()
    await server.stop(true)
    postMessage(JSON.stringify({ type: "shutdown.complete" }))
  }
}

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
