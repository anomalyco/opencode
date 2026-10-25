import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

export type Row = {
  readonly name: string
  readonly directory: string
  readonly branch?: string
}

/** Format worktree rows into aligned lines for the terminal. */
export function table(rows: Row[]) {
  const width = rows.reduce((max, row) => Math.max(max, row.name.length), 0)
  return rows.map((row) => `${row.name.padEnd(width)}  ${row.branch ?? "(detached)"}  ${row.directory}`)
}

/** Match a worktree by name, branch, or directory. Returns the row, or undefined when ambiguous or missing. */
export function pick(rows: Row[], key: string) {
  const hits = rows.filter((row) => row.name === key || row.branch === key || row.directory === key)
  if (hits.length !== 1) return undefined
  return hits[0]
}

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "create, list, and clean agent worktrees",
  builder: (yargs: Argv) =>
    yargs
      .command(WorktreeListCommand)
      .command(WorktreeCreateCommand)
      .command(WorktreeRemoveCommand)
      .command(WorktreeCleanCommand)
      .demandCommand(),
  async handler() {},
})

export const WorktreeListCommand = effectCmd({
  command: "list",
  describe: "list agent worktrees for this project",
  handler: Effect.fn("Cli.worktree.list")(function* () {
    const { Worktree } = yield* Effect.promise(() => import("@/worktree"))
    const worktrees = yield* Worktree.Service
    const rows = yield* worktrees.list().pipe(Effect.catch((error) => fail(error.message)))
    if (!rows.length) {
      UI.println("No agent worktrees. Create one with: bolt worktree create [name]")
      return
    }
    for (const line of table(rows)) UI.println(line)
  }),
})

export const WorktreeCreateCommand = effectCmd({
  command: "create [name]",
  describe: "create a new agent worktree on its own branch",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "worktree name (defaults to a generated slug)",
      })
      .option("start", {
        type: "string",
        describe: "extra startup command to run after the project's start command",
      }),
  handler: Effect.fn("Cli.worktree.create")(function* (args) {
    const { Worktree } = yield* Effect.promise(() => import("@/worktree"))
    const worktrees = yield* Worktree.Service
    const info = yield* worktrees
      .create({ ...(args.name ? { name: args.name } : {}), ...(args.start ? { startCommand: args.start } : {}) })
      .pipe(Effect.catch((error) => fail(error.message)))
    UI.println(`Created ${info.name}${info.branch ? ` on ${info.branch}` : ""} at ${info.directory}`)
  }),
})

export const WorktreeRemoveCommand = effectCmd({
  command: "remove <worktree>",
  describe: "remove one agent worktree and its branch",
  builder: (yargs) =>
    yargs.positional("worktree", {
      type: "string",
      demandOption: true,
      describe: "worktree name, branch, or directory",
    }),
  handler: Effect.fn("Cli.worktree.remove")(function* (args) {
    const { Worktree } = yield* Effect.promise(() => import("@/worktree"))
    const worktrees = yield* Worktree.Service
    const rows = yield* worktrees.list().pipe(Effect.catch((error) => fail(error.message)))
    const row = pick(rows, args.worktree)
    if (!row) {
      return yield* fail(`Could not find exactly one worktree matching "${args.worktree}". Check bolt worktree list.`)
    }
    yield* worktrees.remove({ directory: row.directory }).pipe(Effect.catch((error) => fail(error.message)))
    UI.println(`Removed ${row.name} (${row.directory})`)
  }),
})

export const WorktreeCleanCommand = effectCmd({
  command: "clean",
  describe: "remove every agent worktree for this project",
  builder: (yargs) =>
    yargs.option("apply", {
      type: "boolean",
      default: false,
      describe: "actually remove the worktrees instead of listing what would go",
    }),
  handler: Effect.fn("Cli.worktree.clean")(function* (args) {
    const { Worktree } = yield* Effect.promise(() => import("@/worktree"))
    const worktrees = yield* Worktree.Service
    const rows = yield* worktrees.list().pipe(Effect.catch((error) => fail(error.message)))
    if (!rows.length) {
      UI.println("No agent worktrees to clean.")
      return
    }
    if (!args.apply) {
      UI.println("Would remove:")
      for (const line of table(rows)) UI.println(`  ${line}`)
      UI.println("Rerun with --apply to remove them.")
      return
    }
    const failures: string[] = []
    yield* Effect.forEach(rows, (row) =>
      worktrees.remove({ directory: row.directory }).pipe(
        Effect.tap(() => Effect.sync(() => UI.println(`Removed ${row.name} (${row.directory})`))),
        Effect.catch((error) =>
          Effect.sync(() => {
            failures.push(`${row.name}: ${error.message}`)
          }),
        ),
      ),
    )
    if (!failures.length) return
    return yield* fail(failures.join("\n"))
  }),
})
