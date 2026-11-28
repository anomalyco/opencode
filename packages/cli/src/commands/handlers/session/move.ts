import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import path from "node:path"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const handler = Effect.fn("cli.session.move")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.move>,
) {
  const directory = path.resolve(input.directory)
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  yield* Effect.tryPromise({
    try: (signal) => client.session.move({ sessionID: input.sessionID, directory }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(`Session ${input.sessionID} moved to ${directory}${EOL}`)
})

export default Runtime.handler(Commands.commands.session.commands.move, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
