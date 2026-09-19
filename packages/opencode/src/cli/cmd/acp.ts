import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ServerAuth } from "@/server/auth"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ACPProfile } from "@/acp/profile"

export const AcpCommand = effectCmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: Effect.fn("Cli.acp")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("@/server/server"))
    const { ACP } = yield* Effect.promise(() => import("@/acp/agent"))
    ACPProfile.mark("cli.acp.handler")
    process.env.OPENCODE_CLIENT = "acp"
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => ACPProfile.measure("cli.acp.server.listen", () => Server.listen(opts)))

    const sdk = createOpencodeClient({
      baseUrl: `http://${server.hostname}:${server.port}`,
      headers: ServerAuth.headers(),
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
    let stopReads: () => void = () => {
      process.stdin.pause()
    }
    const output = new ReadableStream<Uint8Array>({
      start(controller) {
        process.stdin.pause()
        const onData = (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
          if ((controller.desiredSize ?? 1) <= 0) process.stdin.pause()
        }
        const onEnd = () => {
          stopReads()
          controller.close()
        }
        const onError = (err: Error) => {
          stopReads()
          controller.error(err)
        }
        stopReads = () => {
          process.stdin.off("data", onData)
          process.stdin.off("end", onEnd)
          process.stdin.off("error", onError)
          process.stdin.pause()
        }
        process.stdin.on("data", onData)
        process.stdin.on("end", onEnd)
        process.stdin.on("error", onError)
      },
      pull() {
        process.stdin.resume()
      },
      cancel() {
        stopReads()
      },
    })

    const stream = ndJsonStream(input, output)
    const agent = ACP.init({ sdk })

    new AgentSideConnection((conn) => {
      ACPProfile.mark("cli.acp.connection.create")
      return agent.create(conn)
    }, stream)

    yield* Effect.logInfo("setup connection")
    process.stdin.resume()
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve, reject) => {
          process.stdin.on("end", () => resolve())
          process.stdin.on("error", reject)
        }),
    )
  }),
})
