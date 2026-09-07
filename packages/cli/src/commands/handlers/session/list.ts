import { OpenCode, type SessionInfo } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect, Option, Stream } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const handler = Effect.fn("cli.session.list")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.list>,
) {
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const location = yield* Effect.tryPromise({
    try: (signal) => client.location.get({ location: { directory: process.cwd() } }, { signal }),
    catch: (cause) => cause,
  })
  const page = yield* Effect.tryPromise({
    try: (signal) =>
      client.session.list(
        {
          project: location.project.id,
          parentID: null,
          order: "desc",
          limit: Option.getOrElse(input.maxCount, () => 100),
        },
        { signal },
      ),
    catch: (cause) => cause,
  })
  if (input.format === "table" && page.data.length === 0) return
  const output =
    (input.format === "json"
      ? JSON.stringify(
          page.data.map((session) => ({
            id: session.id,
            title: session.title,
            updated: session.time.updated,
            created: session.time.created,
            projectId: session.projectID,
            directory: session.location.directory,
          })),
          null,
          2,
        )
      : formatTable(page.data)) + EOL
  const write = Effect.tryPromise(
    () =>
      new Promise<void>((resolve, reject) => {
        process.stdout.write(output, (error) => (error ? reject(error) : resolve()))
      }),
  )
  if (!process.stdout.isTTY || Option.isSome(input.maxCount) || input.format === "json") {
    yield* write
    return
  }

  const { AppProcess } = yield* Effect.promise(() => import("@opencode-ai/util/process"))
  const { LayerNode } = yield* Effect.promise(() => import("@opencode-ai/util/effect/layer-node"))
  const { ChildProcess } = yield* Effect.promise(() => import("effect/unstable/process"))
  yield* Effect.gen(function* () {
    const processService = yield* AppProcess.Service
    const pager = yield* processService
      .spawn(
        ChildProcess.make(
          process.platform === "win32" ? "cmd" : "less",
          process.platform === "win32" ? ["/c", "more"] : ["-R", "-S"],
          {
            stdin: Stream.make(new TextEncoder().encode(output)),
            stdout: "inherit",
            stderr: "inherit",
          },
        ),
      )
      .pipe(Effect.option)
    if (Option.isNone(pager)) {
      yield* write
      return
    }
    yield* pager.value.exitCode
  }).pipe(Effect.provide(LayerNode.compile(AppProcess.node)))
})

export default Runtime.handler(Commands.commands.session.commands.list, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

function formatTable(sessions: ReadonlyArray<SessionInfo>) {
  const rows = sessions.map((session) => ({
    id: session.id,
    title: (session.title ?? "Untitled session").replace(/[\r\n\t]/g, " "),
    updated: new Date(session.time.updated).toLocaleString(),
  }))
  const idWidth = Math.max(20, ...rows.map((row) => row.id.length))
  const titleWidth = Math.max(25, ...rows.map((row) => row.title.length))
  const header = `${"Session ID".padEnd(idWidth)}  ${"Title".padEnd(titleWidth)}  Updated`
  return [
    header,
    "─".repeat(header.length),
    ...rows.map((row) => `${row.id.padEnd(idWidth)}  ${row.title.padEnd(titleWidth)}  ${row.updated}`),
  ].join(EOL)
}
