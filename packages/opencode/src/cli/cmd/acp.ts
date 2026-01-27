import { Log } from "@/util/log"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"
import { Server } from "@/server/server"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

const log = Log.create({ service: "acp-command" })

export const AcpCommand = cmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const opts = await resolveNetworkOptions(args)
      const server = Server.listen(opts)

      const sdk = createOpencodeClient({
        baseUrl: `http://${server.hostname}:${server.port}`,
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
          const onData = (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk))
          }
          const onEnd = () => controller.close()
          const onError = (err: Error) => controller.error(err)

          process.stdin.on("data", onData)
          process.stdin.on("end", onEnd)
          process.stdin.on("error", onError)

          // Store references for cleanup
          ;(controller as any)._onData = onData
          ;(controller as any)._onEnd = onEnd
          ;(controller as any)._onError = onError
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
        const onEnd = () => {
          cleanup()
          resolve(undefined)
        }
        const onError = (err: Error) => {
          cleanup()
          reject(err)
        }

        const cleanup = () => {
          process.stdin.removeListener("end", onEnd)
          process.stdin.removeListener("error", onError)
        }

        process.stdin.once("end", onEnd)
        process.stdin.once("error", onError)
      })
    })
  },
})
