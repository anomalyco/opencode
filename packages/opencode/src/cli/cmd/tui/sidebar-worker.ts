import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Rpc } from "@/util/rpc"

export const rpc = {
  async sidebarServer(input: { port: number; hostname: string; sessionID: string }) {
    Log.Default.info("sidebar worker", { sessionID: input.sessionID })
    const server = Server.listen({ port: input.port, hostname: input.hostname })
    return { url: server.url.toString(), sessionID: input.sessionID }
  },
  async shutdown() {
    Log.Default.info("sidebar worker shutdown")
  },
}

Rpc.listen(rpc)
