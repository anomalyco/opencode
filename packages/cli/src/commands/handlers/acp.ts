import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { OpenCode } from "@opencode-ai/client/promise"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import { ACP } from "../../acp/agent"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Standalone } from "../../services/standalone"

export default Runtime.handler(
  Commands.commands.acp,
  Effect.fn("cli.acp")(function* () {
    process.env.OPENCODE_CLIENT = "acp"
    const endpoint = yield* Standalone.start()
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const input = new WritableStream<Uint8Array>({
      write: (chunk) =>
        new Promise<void>((resolve, reject) => {
          process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()))
        }),
    })
    const output = new ReadableStream<Uint8Array>({
      start(controller) {
        process.stdin.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        process.stdin.on("end", () => controller.close())
        process.stdin.on("error", (error) => controller.error(error))
      },
    })
    const stream = ndJsonStream(input, output)
    const connection = new AgentSideConnection((connection) => ACP.create(client, connection), stream)
    process.stdin.resume()
    yield* Effect.promise(() => connection.closed)
    // EOF owns this stdio process; exiting also closes the private server's lease pipe.
    yield* Effect.sync(() => process.exit(0))
  }),
)
