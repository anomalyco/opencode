import { confirm, log } from "@clack/prompts"
import { OpenCode, isSessionNotFoundError, type SessionInfo } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Clock, Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { parsePruneDuration, selectPruneCandidates } from "./prune-core"

const pageSize = 100

type Client = ReturnType<typeof OpenCode.make>

async function readInventory(client: Client, project: string, signal: AbortSignal) {
  const sessions: SessionInfo[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client.session.list({ project, order: "desc", limit: pageSize, cursor }, { signal })
    sessions.push(...page.data)
    const next = page.cursor.next
    if (!next || seenCursors.has(next)) break
    seenCursors.add(next)
    cursor = next
  } while (cursor)
  const active = await client.session.active({ signal })
  return { sessions, active: new Set(Object.keys(active)) }
}

const handler = Effect.fn("cli.session.prune")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.prune>,
) {
  const duration = parsePruneDuration(input.duration)
  if (duration === undefined)
    return yield* Effect.fail(new Error("Invalid duration. Use a positive value such as 12h, 30d, or 2w."))

  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const location = yield* Effect.tryPromise({
    try: (signal) => client.location.get({ location: { directory: process.cwd() } }, { signal }),
    catch: (cause) => cause,
  })
  const cutoff = (yield* Clock.currentTimeMillis) - duration
  const inventory = yield* Effect.tryPromise({
    try: (signal) => readInventory(client, location.project.id, signal),
    catch: (cause) => cause,
  })
  const candidates = selectPruneCandidates(inventory.sessions, cutoff, inventory.active, input.includeArchived)

  if (candidates.length === 0) {
    log.info("No sessions match the prune criteria.")
    return
  }

  log.info(`Prune cutoff: ${new Date(cutoff).toISOString()}`)
  log.info(`Candidates: ${candidates.length} session ${candidates.length === 1 ? "family" : "families"}`)
  for (const candidate of candidates) {
    log.info(
      `  ${candidate.root.id}  ${candidate.root.title ?? "Untitled session"}  ${candidate.sessions.length} session(s)`,
    )
  }

  if (input.dryRun) {
    log.warn("Dry run - no sessions deleted.")
    return
  }

  if (!input.force) {
    yield* requireInteractive("Use --force to prune without an interactive terminal, or --dry-run to preview.")
    const accepted = yield* prompt(() =>
      confirm({
        message: `Delete ${candidates.length} session ${candidates.length === 1 ? "family" : "families"}?`,
        initialValue: false,
      }),
    )
    if (!accepted) {
      log.info("Aborted.")
      return
    }
  }

  const selected = new Set(candidates.map((candidate) => candidate.root.id))
  const current = yield* Effect.tryPromise({
    try: (signal) => readInventory(client, location.project.id, signal),
    catch: (cause) => cause,
  })
  const safe = selectPruneCandidates(current.sessions, cutoff, current.active, input.includeArchived).filter(
    (candidate) => selected.has(candidate.root.id),
  )
  let deleted = 0
  let deletedSessions = 0
  for (const candidate of safe) {
    const didDelete = yield* Effect.tryPromise({
      try: (signal) => client.session.remove({ sessionID: candidate.root.id }, { signal }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map(() => true),
      Effect.catchIf(isSessionNotFoundError, () => Effect.succeed(false)),
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn(`Could not delete ${candidate.root.id}: ${errorMessage(error)}`)
          return false
        }),
      ),
    )
    if (!didDelete) continue
    deleted++
    deletedSessions += candidate.sessions.length
  }

  log.info(`Deleted ${deleted} session ${deleted === 1 ? "family" : "families"} (${deletedSessions} sessions).${EOL}`)
})

export default Runtime.handler(Commands.commands.session.commands.prune, (input) =>
  handler(input).pipe(handlePromptErrors),
)
