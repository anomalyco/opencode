import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { WorkspaceServer } from "../../control-plane/workspace-server/server"

export const WorkspaceServeCommand = cmd({
  command: "workspace-serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a remote workspace event server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = WorkspaceServer.Listen(opts)
    console.log(`workspace event server listening on ${new URL("/event", server.url).toString()}`)
    await new Promise(() => {})
    await server.stop()
  },
})
