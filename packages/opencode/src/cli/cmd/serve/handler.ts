import { Server } from "../../../server/server"
import { resolveNetworkOptions } from "../../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { ServeArgs } from "./command"

export async function handler(args: ServeArgs) {
  if (!Flag.OPENCODE_SERVER_PASSWORD) {
    console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
  }
  const opts = await resolveNetworkOptions(args)
  const server = await Server.listen(opts)
  console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

  await new Promise(() => {})
  await server.stop()
}
