import { OpenCode, type OpenCodeClient, type SessionInfo } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option, Stream } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const DEFAULT_LIMIT = 100

type ListInput = {
  all: boolean
  maxCount: Option.Option<number>
  noLimit: boolean
}

/**
 * Walk the session list until `--max-count` rows have been collected or the server runs out of
 * pages. `--no-limit` keeps walking until the cursor is exhausted. The project filter is resolved
 * once so every page is scoped the same way.
 */
export async function listSessions(client: OpenCodeClient, input: ListInput, directory: string, signal?: AbortSignal) {
  if (input.noLimit && Option.isSome(input.maxCount)) {
    throw new Error("--no-limit cannot be combined with --max-count")
  }
  const options = signal === undefined ? {} : { signal }
  const project = input.all ? undefined : (await client.location.get({ location: { directory } }, options)).project.id
  const target = Option.getOrElse(input.maxCount, () => DEFAULT_LIMIT)
  const sessions: SessionInfo[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    const remaining = input.noLimit ? DEFAULT_LIMIT : target - sessions.length
    if (!input.noLimit && remaining <= 0) break
    const page = await client.session.list(
      {
        ...(project === undefined ? {} : { project }),
        parentID: null,
        order: "desc",
        limit: remaining,
        ...(cursor === undefined ? {} : { cursor }),
      },
      options,
    )
    sessions.push(...page.data)
    const next = page.cursor.next
    if (!next || page.data.length === 0 || seen.has(next)) break
    seen.add(next)
    cursor = next
  }
  return input.noLimit ? sessions : sessions.slice(0, target)
}

const handler = Effect.fn("cli.session.list")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.list>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const sessions = yield* Effect.tryPromise({
    try: (signal) => listSessions(client, input, process.cwd(), signal),
    catch: (cause) => cause,
  })
  if (input.format === "table" && sessions.length === 0) return
  const output =
    (input.format === "json"
      ? JSON.stringify(
          sessions.map((session) => ({
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
      : formatList(sessions, input.all)) + EOL
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

  const { AppProcess } = yield* Effect.promise(() => import("@opencode/util/process"))
  const { LayerNode } = yield* Effect.promise(() => import("@opencode/util/effect/layer-node"))
  const { ChildProcess } = yield* Effect.promise(() => import("effect/process"))
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

/** Tab-separated rows: id, title and updated time, plus the directory when sessions come from every project. */
export function formatList(sessions: ReadonlyArray<SessionInfo>, all: boolean) {
  return sessions
    .map((session) =>
      [
        session.id,
        (session.title ?? "Untitled session").replace(/[\r\n\t]/g, " "),
        new Date(session.time.updated).toLocaleString(),
        ...(all ? [session.location.directory.replace(/[\r\n\t]/g, " ")] : []),
      ].join("\t"),
    )
    .join(EOL)
}
