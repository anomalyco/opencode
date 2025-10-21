import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { OpenCodeAgent } from "./agent"

export namespace ACPServer {
  const log = Log.create({ service: "acp-server" })

  export async function start() {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        log.info("starting ACP server", { cwd: process.cwd() })

        const stdout = new WritableStream({
          write(chunk) {
            process.stdout.write(chunk)
          },
        })

        const stdin = new ReadableStream({
          start(controller) {
            process.stdin.on("data", (chunk) => {
              controller.enqueue(new Uint8Array(chunk))
            })
            process.stdin.on("end", () => {
              controller.close()
            })
          },
        })

        const stream = ndJsonStream(stdout, stdin)

        new AgentSideConnection((conn) => {
          return new OpenCodeAgent(conn)
        }, stream)

        await new Promise<void>((resolve) => {
          process.on("SIGTERM", () => {
            log.info("received SIGTERM")
            resolve()
          })
          process.on("SIGINT", () => {
            log.info("received SIGINT")
            resolve()
          })
        })

        log.info("ACP server stopped")
      },
    })
  }
}
