import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

/** Render a checkpoint age like "2m ago" for the list output. */
export function age(now: number, time: number) {
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export const CheckpointCommand = cmd({
  command: "checkpoint",
  describe: "save and rewind named checkpoints",
  builder: (yargs: Argv) =>
    yargs
      .command(CheckpointSaveCommand)
      .command(CheckpointListCommand)
      .command(CheckpointRewindCommand)
      .command(CheckpointRemoveCommand)
      .demandCommand(),
  async handler() {},
})

export const CheckpointSaveCommand = effectCmd({
  command: "save <name>",
  describe: "save the repo and the current conversation as a named checkpoint",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "checkpoint name",
        type: "string",
        demandOption: true,
      })
      .option("session", {
        alias: "s",
        type: "string",
        describe: "session id to attach (defaults to the most recent session)",
      })
      .option("repo-only", {
        type: "boolean",
        default: false,
        describe: "checkpoint the repository state only, without a conversation marker",
      }),
  handler: Effect.fn("Cli.checkpoint.save")(function* (args) {
    const { Checkpoint } = yield* Effect.promise(() => import("@/checkpoint"))
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionID } = yield* Effect.promise(() => import("@/session/schema"))
    const checkpoints = yield* Checkpoint.Service
    const sessions = yield* Session.Service

    const sessionID = yield* Effect.gen(function* () {
      if (args["repo-only"]) return undefined
      if (args.session) {
        const found = yield* sessions
          .get(SessionID.make(args.session))
          .pipe(Effect.catch(() => fail(`Session not found: ${args.session}`)))
        return found.id
      }
      const all = yield* sessions.list()
      return all.find((item) => !item.parentID)?.id
    })

    const info = yield* checkpoints.save({ name: args.name, sessionID }).pipe(
      Effect.catchTag("CheckpointNameError", () =>
        fail(`Invalid checkpoint name "${args.name}". Use letters, numbers, dots, dashes, or underscores.`),
      ),
      Effect.catchTag("CheckpointDisabledError", () =>
        fail("Snapshots are disabled for this project, so checkpoints cannot be saved."),
      ),
      Effect.catchTag("NotFoundError", () => fail(`Session not found: ${sessionID}`)),
    )
    const suffix = info.sessionID ? ` (session ${info.sessionID})` : " (repo only)"
    UI.println(`Saved checkpoint "${info.name}"${suffix}`)
  }),
})

export const CheckpointListCommand = effectCmd({
  command: "list",
  aliases: "ls",
  describe: "list saved checkpoints",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.checkpoint.list")(function* () {
    const { Checkpoint } = yield* Effect.promise(() => import("@/checkpoint"))
    const checkpoints = yield* Checkpoint.Service
    const all = yield* checkpoints.list()
    if (all.length === 0) {
      UI.println("No checkpoints saved.")
      return
    }
    const now = Date.now()
    for (const item of all) {
      const scope = item.sessionID ? `session ${item.sessionID}` : "repo only"
      UI.println(`${item.name}  ${age(now, item.time)}  ${scope}`)
    }
  }),
})

export const CheckpointRewindCommand = effectCmd({
  command: "rewind <name>",
  describe: "rewind the repo and the conversation to a checkpoint",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "checkpoint name",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.checkpoint.rewind")(function* (args) {
    const { Checkpoint } = yield* Effect.promise(() => import("@/checkpoint"))
    const checkpoints = yield* Checkpoint.Service
    const info = yield* checkpoints.rewind(args.name).pipe(
      Effect.catchTag("CheckpointNotFoundError", () => fail(`No checkpoint named "${args.name}".`)),
      Effect.catchTag("SessionBusyError", () =>
        fail("The attached session is busy. Wait for it to go idle and retry."),
      ),
    )
    const suffix = info.sessionID ? " Repo and conversation restored." : " Repo restored."
    UI.println(`Rewound to checkpoint "${info.name}".${suffix}`)
  }),
})

export const CheckpointRemoveCommand = effectCmd({
  command: "remove <name>",
  aliases: "rm",
  describe: "delete a checkpoint",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "checkpoint name",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.checkpoint.remove")(function* (args) {
    const { Checkpoint } = yield* Effect.promise(() => import("@/checkpoint"))
    const checkpoints = yield* Checkpoint.Service
    yield* checkpoints
      .remove(args.name)
      .pipe(Effect.catchTag("CheckpointNotFoundError", () => fail(`No checkpoint named "${args.name}".`)))
    UI.println(`Removed checkpoint "${args.name}".`)
  }),
})
