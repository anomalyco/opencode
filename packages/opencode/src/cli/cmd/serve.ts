import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { normalizeBasePath } from "../../util/base-path"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    const basePath = normalizeBasePath(opts.basePath)
    const pathSuffix = basePath ? `${basePath}/` : ""
    console.log(`opencode server listening on http://${server.hostname}:${server.port}${pathSuffix}`)
    await new Promise(() => {})
    await server.stop()
  },
})
