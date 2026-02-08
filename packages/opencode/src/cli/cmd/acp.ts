import { Log } from "@/util/log"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"
import { Server } from "@/server/server"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "acp-command" })

export const AcpCommand = cmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs)
      .option("cwd", {
        describe: "working directory",
        type: "string",
        default: process.cwd(),
      })
      .option("connect", {
        describe: "URL of an existing OpenCode server to connect to (can also use OPENCODE_SERVER_URL env var)",
        type: "string",
      })
  },
  handler: async (args) => {
    process.env.OPENCODE_CLIENT = "acp"
    await bootstrap(process.cwd(), async () => {
      // Check for external server URL from CLI flag or environment variable
      const externalServerUrl = args.connect || Flag.OPENCODE_SERVER_URL

      let serverUrl: string
      let ownedServer: ReturnType<typeof Server.listen> | null = null

      if (externalServerUrl) {
        log.info(`Connecting to external OpenCode server at ${externalServerUrl}`)
        serverUrl = externalServerUrl
      } else {
        const opts = await resolveNetworkOptions(args)
        ownedServer = Server.listen(opts)
        serverUrl = `http://${ownedServer.hostname}:${ownedServer.port}`
        log.info(`Started embedded OpenCode server at ${serverUrl}`)
      }

      const sdk = createOpencodeClient({ baseUrl: serverUrl })

      const input = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise<void>((resolve, reject) => {
            process.stdout.write(chunk, (err) => {
              if (err) {
                reject(err)
              } else {
                resolve()
              }
            })
          })
        },
      })
      const output = new ReadableStream<Uint8Array>({
        start(controller) {
          process.stdin.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk))
          })
          process.stdin.on("end", () => controller.close())
          process.stdin.on("error", (err) => controller.error(err))
        },
      })

      const stream = ndJsonStream(input, output)
      const agent = await ACP.init({ sdk })

      new AgentSideConnection((conn) => {
        return agent.create(conn, { sdk })
      }, stream)

      log.info("setup connection")
      process.stdin.resume()
      await new Promise((resolve, reject) => {
        process.stdin.on("end", resolve)
        process.stdin.on("error", reject)
      })
    })
  },
})
