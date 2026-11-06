import { ClientError, OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option, Predicate } from "effect"
import { EOL } from "node:os"
import path from "node:path"
import { Commands, Server as ServerFlag } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { ServiceConfig } from "../../../services/service-config"
import { errorMessage } from "../../../util/error"

const handler = Effect.fn("cli.debug.heap-dump")(function* (
  input: Runtime.Input<(typeof Commands.commands.debug.commands)["heap-dump"]>,
) {
  const server = yield* Effect.serviceOption(ServerFlag).pipe(Effect.map(Option.flatten))
  const endpoint = yield* running(Option.getOrUndefined(server))
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  // The server writes the file, so a relative directory resolves against this shell. An absolute one passes through
  // untouched, which keeps a POSIX path for a remote server intact on Windows.
  const directory = Option.match(input.directory, {
    onNone: () => undefined,
    onSome: (value) => (path.isAbsolute(value) ? value : path.resolve(value)),
  })
  const snapshot = yield* Effect.tryPromise({
    try: (signal) => client.debug.heapDump({ directory }, { signal }),
    catch: (cause) =>
      cause instanceof ClientError &&
      cause.reason === "UnexpectedStatus" &&
      Predicate.hasProperty(cause.cause, "status") &&
      cause.cause.status === 404
        ? new Error(`The server at ${endpoint.url} does not support heap dumps. Update and restart it first.`)
        : cause,
  })
  // Servers released before `directory` existed ignore it and write into their log directory. The server joins the
  // directory and file name, so join the same way, with the path style of the server's machine: that tolerates a
  // trailing separator and keeps a POSIX path from a remote server intact on Windows.
  const style = /^([A-Za-z]:|\\\\)/.test(snapshot.path) ? path.win32 : path.posix
  if (directory !== undefined && style.join(directory, style.basename(snapshot.path)) !== snapshot.path)
    process.stderr.write(`The server ignored --directory. Update and restart it to choose where snapshots go.${EOL}`)
  process.stdout.write(snapshot.path + EOL)
})

export default Runtime.handler(Commands.commands.debug.commands["heap-dump"], (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

// A fresh server has nothing worth capturing, so only an already-running one is used: never start,
// replace, or restart the background service.
const running = Effect.fnUntraced(function* (server: string | undefined) {
  if (server !== undefined) return (yield* ServerConnection.resolve({ server })).endpoint
  const options = yield* ServiceConfig.options()
  const endpoint = yield* Service.discover({ ...options, version: undefined })
  if (endpoint) return endpoint
  return yield* Effect.fail(
    new Error("No background server is running. Pass --server <url> to capture a server started another way."),
  )
})
