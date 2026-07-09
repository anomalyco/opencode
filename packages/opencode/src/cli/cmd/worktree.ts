import type { Argv } from "yargs"
import { EOL } from "os"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Worktree } from "@/worktree"
import { UI } from "../ui"
import { GlobalBus, type GlobalEvent } from "@/bus/global"

function formatTable(entries: (Omit<Worktree.Info, "branch"> & { branch?: string })[]): string {
  const maxName = Math.max(4, ...entries.map((e) => e.name.length))
  const maxBranch = Math.max(6, ...entries.map((e) => (e.branch ?? "-").length))
  const fmt = `  ${"Name".padEnd(maxName)}  ${"Branch".padEnd(maxBranch)}  Directory`
  const sep = "  " + "─".repeat(maxName) + "  " + "─".repeat(maxBranch) + "  " + "─".repeat(80)
  const rows = entries.map(
    (e) => `  ${e.name.padEnd(maxName)}  ${(e.branch ?? "-").padEnd(maxBranch)}  ${e.directory}`,
  )
  return [fmt, sep, ...rows].join(EOL)
}

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "manage git worktrees",
  builder: (yargs: Argv) =>
    yargs
      .command(WorktreeCreateCommand)
      .command(WorktreeListCommand)
      .command(WorktreeRemoveCommand)
      .command(WorktreeResetCommand)
      .demandCommand(),
  async handler() {},
})

const waitWorktreeEvent = (directory: string) =>
  Effect.callback<"ready" | "failed", never>((resume) => {
    const handler = (event: GlobalEvent) => {
      if (event.directory !== directory) return
      if (event.payload.type === Worktree.Event.Ready.type) {
        GlobalBus.off("event", handler)
        resume(Effect.succeed("ready" as const))
      }
      if (event.payload.type === Worktree.Event.Failed.type) {
        GlobalBus.off("event", handler)
        resume(Effect.succeed("failed" as const))
      }
    }

    GlobalBus.on("event", handler)
    return Effect.sync(() => GlobalBus.off("event", handler))
  })

export const WorktreeCreateCommand = effectCmd({
  command: "create",
  describe: "create a worktree",
  builder: (yargs) =>
    yargs
      .option("name", {
        describe: "worktree name (slug; generated if omitted)",
        type: "string",
      })
      .option("start-command", {
        describe: "additional startup script",
        type: "string",
      }),
  handler: Effect.fn("Cli.worktree.create")(function* (args) {
    const svc = yield* Worktree.Service
    const info = yield* svc.create({ name: args.name, startCommand: args.startCommand }).pipe(
      Effect.catch((e) => fail(e.message)),
    )

    UI.println(UI.Style.TEXT_DIM + "Worktree directory: " + UI.Style.TEXT_NORMAL + info.directory)
    if (info.branch) {
      UI.println(UI.Style.TEXT_DIM + "Branch:             " + UI.Style.TEXT_NORMAL + info.branch)
    }
    UI.empty()

    const result = yield* waitWorktreeEvent(info.directory).pipe(
      Effect.timeoutOrElse({
        duration: "120 seconds",
        orElse: () => Effect.succeed("timeout" as const),
      }),
    )

    if (result === "timeout") {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "Worktree created but bootstrap still running" + UI.Style.TEXT_NORMAL)
      return
    }

    if (result === "failed") {
      return yield* fail("Worktree bootstrap failed")
    }

    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Worktree ready" + UI.Style.TEXT_NORMAL)
  }),
})

export const WorktreeListCommand = effectCmd({
  command: "list",
  describe: "list worktrees",
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.worktree.list")(function* (args) {
    const svc = yield* Worktree.Service
    const list = yield* svc.list().pipe(
      Effect.catch((e) => fail(e.message)),
    )
    if (list.length === 0) return
    if (args.format === "json") {
      console.log(JSON.stringify(list, null, 2))
    } else {
      console.log(formatTable(list))
    }
  }),
})

const resolveWorktreeName = Effect.fnUntraced(function* (svc: Worktree.Interface, name: string) {
  const list = yield* svc.list()
  const match = list.find((w) => w.name === name)
  if (!match) return name
  return match.directory
})

export const WorktreeRemoveCommand = effectCmd({
  command: "remove <name>",
  describe: "remove a worktree",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "worktree name or directory",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.worktree.remove")(function* (args) {
    const svc = yield* Worktree.Service
    const directory = yield* resolveWorktreeName(svc, args.name)
    yield* svc.remove({ directory }).pipe(
      Effect.catch((e) => fail(e.message)),
    )
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Worktree removed" + UI.Style.TEXT_NORMAL)
  }),
})

export const WorktreeResetCommand = effectCmd({
  command: "reset <name>",
  describe: "reset a worktree",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "worktree name or directory",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.worktree.reset")(function* (args) {
    const svc = yield* Worktree.Service
    const directory = yield* resolveWorktreeName(svc, args.name)
    yield* svc.reset({ directory }).pipe(
      Effect.catch((e) => fail(e.message)),
    )
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Worktree reset" + UI.Style.TEXT_NORMAL)
  }),
})
