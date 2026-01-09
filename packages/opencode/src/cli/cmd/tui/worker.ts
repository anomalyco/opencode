import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import type { BunWebSocketData } from "hono/bun"
import { Config } from "@/config/config"

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

let server: Bun.Server<BunWebSocketData>
export const rpc = {
  async server(input: { port: number; hostname: string; mdns?: boolean }) {
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
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    await Instance.disposeAll()
    // TODO: this should be awaited, but ws connections are
    // causing this to hang, need to revisit this
    server.stop(true)
  },
}

Rpc.listen(rpc)
