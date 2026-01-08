import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("prompt", {
      describe: "prompt to use",
      type: "string",
    })
  },
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    const baseUrl = `http://${server.hostname}:${server.port}`

    // If prompt is provided, create a session and send the prompt
    if (args.prompt) {
      const sdk = createOpencodeClient({
        baseUrl,
      })

      const session = await sdk.session.create({ directory: process.cwd() })
      if (!session.data) throw new Error("Failed to create session")

      // Send the prompt to the session (fire and forget)
      sdk.session
        .prompt({
          sessionID: session.data.id,
          directory: process.cwd(),
          parts: [
            {
              type: "text",
              text: args.prompt,
            },
          ],
        })
        .catch(() => {})

      console.log(`opencode server listening on ${baseUrl}`)
      console.log(`session created: ${baseUrl}/${session.data.id}/session/${session.data.id}`)
    } else {
      console.log(`opencode server listening on ${baseUrl}`)
    }

    await new Promise(() => {})
    await server.stop()
  },
})
