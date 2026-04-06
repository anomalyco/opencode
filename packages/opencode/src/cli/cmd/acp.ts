import { Log } from "@/util/log"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"
import { Server } from "@/server/server"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { parseSessionUrl } from "@/util/parse-session-url"

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
      .option("prompt", {
        describe: "prompt to use",
        type: "string",
      })
      .option("attach", {
        describe: "attach to existing server URL or session URL instead of starting new one",
        type: "string",
      })
      .option("session", {
        describe: "session id to continue",
        type: "string",
        alias: ["s"],
      })
  },
  handler: async (args) => {
    process.env.OPENCODE_CLIENT = "acp"
    await bootstrap(process.cwd(), async () => {
      let server: ReturnType<typeof Server.listen> | undefined
      let baseUrl: string
      let sessionId: string | undefined

      // If attach URL is provided, use it instead of starting a server
      if (args.attach) {
        const parsed = parseSessionUrl(args.attach)
        baseUrl = parsed.baseUrl
        sessionId = args.session ?? parsed.sessionId
      } else {
        const opts = await resolveNetworkOptions(args)
        server = Server.listen(opts)
        baseUrl = `http://${server.hostname}:${server.port}`
        sessionId = args.session
      }

      const sdk = createOpencodeClient({
        baseUrl,
      })

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
        return agent.create(conn, { sdk, initialPrompt: args.prompt, sessionId })
      }, stream)

      log.info("setup connection")
      process.stdin.resume()
      await new Promise((resolve, reject) => {
        process.stdin.on("end", resolve)
        process.stdin.on("error", reject)
      })

      // Only stop server if we started one
      if (server) {
        await server.stop()
      }
    })
  },
})
