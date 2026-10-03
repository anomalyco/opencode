import type { Argv } from "yargs"
import { confirm, isCancel } from "@clack/prompts"
import { Clock, Effect, Exit } from "effect"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { Locale } from "@/util/locale"

import { parsePruneDuration, selectPruneCandidates } from "./session-prune-core"

export const SessionPruneCommand = effectCmd({
  command: "prune <duration>",
  describe: "delete sessions older than a duration",
  builder: (yargs: Argv) =>
    yargs
      .positional("duration", {
        describe: "age threshold such as 12h, 30d, or 2w",
        type: "string",
        demandOption: true,
      })
      .option("dry-run", {
        describe: "show candidates without deleting them",
        type: "boolean",
        default: false,
      })
      .option("force", {
        alias: "f",
        describe: "skip confirmation prompts",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.session.prune")(function* (args) {
    const duration = parsePruneDuration(args.duration as string)
    if (duration === undefined) return yield* fail("Invalid duration. Use a positive value such as 12h, 30d, or 2w.")

    const cutoff = (yield* Clock.currentTimeMillis) - duration
    const session = yield* Session.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* session.listAll()
    const candidates = selectPruneCandidates(sessions, cutoff, yield* status.list())

    if (candidates.length === 0) {
      UI.println("No sessions match the prune criteria.")
      return
    }

    UI.println(`Prune cutoff: ${new Date(cutoff).toISOString()}`)
    UI.println(`Candidates: ${candidates.length} session ${candidates.length === 1 ? "family" : "families"}`)
    for (const candidate of candidates) {
      UI.println(
        `  ${candidate.root.id}  ${Locale.truncate(candidate.root.title ?? "Untitled session", 60)}  ${candidate.sessions.length} session(s)`,
      )
    }

    if (args.dryRun) {
      UI.println("Dry run - no sessions deleted.")
      return
    }

    if (!args.force) {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        return yield* fail("Refusing to delete sessions without --force in non-interactive mode.")

      const answer = yield* Effect.promise(() =>
        confirm({
          message: `Delete ${candidates.length} session ${candidates.length === 1 ? "family" : "families"}?`,
          initialValue: false,
        }),
      )
      if (isCancel(answer) || !answer) {
        UI.println("Aborted.")
        return
      }
    }

    const selected = new Set(candidates.map((candidate) => candidate.root.id))
    const current = selectPruneCandidates(yield* session.listAll(), cutoff, yield* status.list()).filter((candidate) =>
      selected.has(candidate.root.id),
    )
    let deleted = 0
    let deletedSessions = 0
    for (const candidate of current) {
      const result = yield* session.remove(candidate.root.id).pipe(Effect.exit)
      if (Exit.isSuccess(result)) {
        deleted++
        deletedSessions += candidate.sessions.length
        continue
      }
      UI.println(`Could not delete ${candidate.root.id}; it may have changed or disappeared.`)
    }

    UI.println(`Deleted ${deleted} session ${deleted === 1 ? "family" : "families"} (${deletedSessions} sessions).`)
  }),
})
