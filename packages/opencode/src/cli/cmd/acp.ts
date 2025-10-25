import { Log } from "@/util/log"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"

const log = Log.create({ service: "acp-command" })

process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled rejection", {
    promise,
    reason,
  })
})

export const AcpCommand = cmd({
  command: "acp",
  describe: "Start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return yargs.option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: async (opts) => {
    if (opts.cwd) process.chdir(opts["cwd"])
    await bootstrap(process.cwd(), async () => {
      const input = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise<void>((resolve, reject) => {
            process.stdout.write(Buffer.from(chunk), (err) => {
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

      new AgentSideConnection((conn) => {
        return new ACP.Agent(conn)
      }, stream)

      log.info("setup connection")
    })
    process.stdin.resume()
  },
})
