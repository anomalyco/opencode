import { Effect } from "effect"
import { SessionV1 } from "@bolt-ai/core/v1/session"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { UI } from "../ui"

// Compiles the user pattern, returning undefined for invalid regexes so the
// command can fail with a clean message instead of a defect.
export function build(pattern: string, insensitive: boolean): RegExp | undefined {
  try {
    return new RegExp(pattern, insensitive ? "i" : undefined)
  } catch {
    return undefined
  }
}

// Extracts the transcript lines of a message that match: user and assistant
// text, reasoning, and completed tool output.
export function lines(parts: readonly SessionV1.Part[], regex: RegExp): string[] {
  return parts
    .flatMap((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.text.split("\n")
      if (part.type === "tool" && part.state.status === "completed") return part.state.output.split("\n")
      return []
    })
    .filter((line) => regex.test(line))
}

const size = 100

export const GrepCommand = effectCmd({
  command: "grep <pattern>",
  describe: "full-text search across every session transcript on disk",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        describe: "regular expression to search for",
        type: "string",
        demandOption: true,
      })
      .option("ignore-case", {
        alias: "i",
        describe: "case-insensitive matching",
        type: "boolean",
        default: false,
      })
      .option("limit", {
        describe: "stop after this many matching lines",
        type: "number",
      })
      .option("json", {
        describe: "output matches as JSON",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.grep")(function* (args) {
    const regex = build(args.pattern, args.ignoreCase)
    if (!regex) return yield* fail(`Invalid pattern: ${args.pattern}`)
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
      return yield* fail("--limit must be a positive integer")
    }

    const svc = yield* Session.Service
    const hits: { sessionID: string; title: string; messageID: string; line: string }[] = []
    let cursor: number | undefined

    while (true) {
      const sessions = yield* svc.listGlobal({ archived: true, limit: size, cursor })
      if (sessions.length === 0) break
      for (const session of sessions) {
        if (args.limit !== undefined && hits.length >= args.limit) break
        const messages = yield* svc
          .messages({ sessionID: session.id })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed([] as SessionV1.WithParts[])))
        for (const msg of messages) {
          for (const line of lines(msg.parts, regex)) {
            if (args.limit !== undefined && hits.length >= args.limit) break
            hits.push({ sessionID: session.id, title: session.title, messageID: msg.info.id, line: line.trim() })
          }
        }
      }
      if (args.limit !== undefined && hits.length >= args.limit) break
      if (sessions.length < size) break
      cursor = sessions[sessions.length - 1].time.updated
    }

    if (hits.length === 0) {
      process.exitCode = 1
      return
    }

    if (args.json) {
      console.log(JSON.stringify(hits, null, 2))
      return
    }

    let previous = ""
    for (const hit of hits) {
      if (hit.sessionID !== previous) {
        previous = hit.sessionID
        UI.println(UI.Style.TEXT_INFO_BOLD + hit.sessionID + UI.Style.TEXT_NORMAL + ` ${hit.title}`)
      }
      UI.println(`  ${hit.messageID}: ${hit.line}`)
    }
  }),
})
