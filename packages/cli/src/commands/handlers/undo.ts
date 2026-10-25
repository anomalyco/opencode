import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

/**
 * Pick the user message an undo should rewind to: the most recent user turn,
 * or the one before the current revert marker when undos are stacked.
 */
export function target<T extends string>(messages: { id: T; role: string }[], marker?: string) {
  const users = messages.filter((item) => item.role === "user")
  const candidates = marker ? users.filter((item) => item.id < marker) : users
  return candidates.at(-1)?.id
}

export const UndoCommand = effectCmd({
  command: "undo",
  describe: "roll back the last agent turn (files and conversation)",
  builder: (yargs) =>
    yargs
      .option("session", {
        alias: "s",
        type: "string",
        describe: "session id to undo (defaults to the most recent session)",
      })
      .option("redo", {
        type: "boolean",
        default: false,
        describe: "restore what the last undo rolled back",
      }),
  handler: Effect.fn("Cli.undo")(function* (args) {
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionRevert } = yield* Effect.promise(() => import("@/session/revert"))
    const { SessionID } = yield* Effect.promise(() => import("@/session/schema"))
    const sessions = yield* Session.Service
    const revert = yield* SessionRevert.Service

    const session = yield* Effect.gen(function* () {
      if (args.session) {
        return yield* sessions
          .get(SessionID.make(args.session))
          .pipe(Effect.catch(() => fail(`Session not found: ${args.session}`)))
      }
      const all = yield* sessions.list()
      const latest = all.find((item) => !item.parentID)
      if (!latest) return yield* fail("No sessions found in this project.")
      return latest
    })

    if (args.redo) {
      if (!session.revert) return yield* fail("Nothing to redo: the session has no pending undo.")
      yield* revert
        .unrevert({ sessionID: session.id })
        .pipe(Effect.catchTag("SessionBusyError", () => fail("The session is busy. Wait for it to go idle and retry.")))
      UI.println(`Restored session ${session.id} to its state before the undo.`)
      return
    }

    const messages = yield* sessions.messages({ sessionID: session.id }).pipe(Effect.orDie)
    const messageID = target(
      messages.map((item) => ({ id: item.info.id, role: item.info.role })),
      session.revert?.messageID,
    )
    if (!messageID) return yield* fail("Nothing to undo: no earlier user turn to rewind to.")

    const updated = yield* revert
      .revert({ sessionID: session.id, messageID })
      .pipe(Effect.catchTag("SessionBusyError", () => fail("The session is busy. Wait for it to go idle and retry.")))

    const summary = updated.summary
    const detail = summary
      ? ` ${summary.files} file${summary.files === 1 ? "" : "s"} rolled back (+${summary.additions}/-${summary.deletions}).`
      : ""
    UI.println(`Undid the last turn of session ${session.id}.${detail}`)
    UI.println("The undo stays pending until the conversation continues. Restore it with: bolt undo --redo")
  }),
})
