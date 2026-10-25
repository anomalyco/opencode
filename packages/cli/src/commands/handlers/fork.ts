import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionBranch } from "@/session/branch"
import { MessageID, SessionID } from "../../session/schema"
import { UI } from "../ui"
import { NotFoundError } from "@/storage/storage"

// Top-level ergonomics for the shipped session branching internals: fork a
// session at any message (inclusive) and continue down a different path. The
// copied prefix stays byte-identical so provider prompt caches keep hitting.
export const ForkCommand = effectCmd({
  command: "fork <sessionID> [messageID]",
  describe: "fork a session at any message and continue down a different path",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session id to fork",
        type: "string",
        demandOption: true,
      })
      .positional("messageID", {
        describe: "fork at this message (inclusive); defaults to the full history",
        type: "string",
      })
      .option("resume", {
        describe: "open the fork interactively right away",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.fork")(function* (args) {
    const svc = yield* Session.Service
    const sessionID = SessionID.make(args.sessionID)
    const messages = yield* svc
      .messages({ sessionID })
      .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session not found: ${args.sessionID}`)))
    const split = SessionBranch.boundary(messages, args.messageID ? MessageID.make(args.messageID) : undefined)
    if (!split) return yield* fail(`Message not found in session: ${args.messageID}`)
    const session = yield* svc
      .fork({ sessionID, messageID: split.fork })
      .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session not found: ${args.sessionID}`)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Forked into ${session.id}` + UI.Style.TEXT_NORMAL + ` ${session.title}`)

    if (!args.resume) {
      UI.println(`Continue it with: bolt run --session ${session.id} "<prompt>"`)
      return
    }
    if (!process.stdout.isTTY) return yield* fail("--resume requires an interactive terminal")
    const { runMini } = yield* Effect.promise(() => import("./run"))
    yield* Effect.promise(() => runMini({ session: session.id }))
  }),
})
