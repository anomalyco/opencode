import { Effect } from "effect"
import { autocomplete, isCancel } from "@clack/prompts"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionID } from "../../session/schema"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { NotFoundError } from "@/storage/storage"

// fzf-style subsequence match: every query character (spaces ignored) must
// appear in order. The score sums the gaps between matched characters, so
// earlier and denser matches rank first; undefined means no match.
export function fuzzy(query: string, text: string): number | undefined {
  const target = text.toLowerCase()
  let score = 0
  let last = -1
  for (const char of query.toLowerCase()) {
    if (char === " ") continue
    const index = target.indexOf(char, last + 1)
    if (index < 0) return undefined
    score += index - last - 1
    last = index
  }
  return score
}

// Filters and sorts picker options by fuzzy score against label and hint,
// preserving the incoming order (most recent first) between equal scores.
export function rank<T extends { label: string; hint?: string }>(query: string, options: T[]): T[] {
  return options
    .flatMap((option) => {
      const score = fuzzy(query, option.hint ? `${option.label} ${option.hint}` : option.label)
      return score === undefined ? [] : [{ option, score }]
    })
    .sort((a, b) => a.score - b.score)
    .map((item) => item.option)
}

export const ResumeCommand = effectCmd({
  command: "resume [sessionID]",
  describe: "resume a session, with a fuzzy picker when no id is given",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session id to resume; omit to pick interactively",
      type: "string",
    }),
  handler: Effect.fn("Cli.resume")(function* (args) {
    if (!process.stdout.isTTY) return yield* fail("bolt resume requires an interactive terminal")

    const svc = yield* Session.Service
    const sessionID = yield* Effect.gen(function* () {
      if (args.sessionID) {
        const id = SessionID.make(args.sessionID)
        yield* svc
          .get(id)
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session not found: ${args.sessionID}`)))
        return id
      }

      const sessions = yield* svc.list({ roots: true })
      if (sessions.length === 0) return yield* fail("No sessions found")
      sessions.sort((a, b) => b.time.updated - a.time.updated)

      const options = sessions.map((session) => ({
        label: session.title,
        value: session.id,
        hint: `${Locale.todayTimeOrDateTime(session.time.updated)} • ${session.id.slice(-8)}`,
      }))

      const picked = yield* Effect.promise(() =>
        autocomplete<SessionID>({
          message: "Resume session",
          maxItems: 10,
          options() {
            return rank(this.userInput, options)
          },
        }),
      )
      if (isCancel(picked)) return yield* Effect.die(new UI.CancelledError())
      return picked
    })

    const { runMini } = yield* Effect.promise(() => import("./run"))
    yield* Effect.promise(() => runMini({ session: sessionID }))
  }),
})
