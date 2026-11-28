import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const setArchived = Effect.fn("cli.session.setArchived")(
  function* (sessionID: string, archived: boolean) {
    const server = yield* ServerConnection.resolve()
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    yield* Effect.tryPromise({
      try: (signal) => client.session.update({ sessionID, archived }, { signal }),
      catch: (cause) => cause,
    })
    process.stdout.write(`Session ${sessionID} ${archived ? "archived" : "unarchived"}${EOL}`)
  },
  Effect.catch((error) =>
    Effect.sync(() => {
      process.stderr.write(errorMessage(error) + EOL)
      process.exitCode = 1
    }),
  ),
)

export const archive = Runtime.handler(Commands.commands.session.commands.archive, (input) =>
  setArchived(input.sessionID, true),
)

export const unarchive = Runtime.handler(Commands.commands.session.commands.unarchive, (input) =>
  setArchived(input.sessionID, false),
)
