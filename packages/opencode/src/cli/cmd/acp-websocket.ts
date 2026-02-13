import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"

export const AcpWebSocketCommand = cmd({
  command: "acp-websocket",
  describe: "start server with ACP (Agent Client Protocol) over WebSocket at /acp",
  builder: (yargs) => withNetworkOptions(yargs),
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    console.log(`ACP WebSocket endpoint: ws://${server.hostname}:${server.port}/acp`)
    await new Promise(() => {})
    await server.stop()
  },
})
