import type { Argv } from "yargs"
import path from "path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { Filesystem } from "@/util/filesystem"

export type Pane = {
  readonly directory: string
  readonly command: string
}

const LAYOUTS = ["tiled", "even-horizontal", "even-vertical", "main-horizontal", "main-vertical"] as const

/** Resolve the pane list: one pane per directory, or `count` panes in the current directory. */
export function panes(input: { dirs: string[]; count: number; cwd: string; command: string }): Pane[] {
  if (input.dirs.length) return input.dirs.map((directory) => ({ directory, command: input.command }))
  return Array.from({ length: input.count }, () => ({ directory: input.cwd, command: input.command }))
}

/**
 * Build the tmux invocations for the requested panes. Inside an existing tmux
 * client the current window is split; outside, a detached session is created
 * and optionally attached.
 */
export function plan(input: { panes: Pane[]; inside: boolean; name: string; layout: string; attach: boolean }) {
  const steps: string[][] = []
  if (input.inside) {
    for (const pane of input.panes) steps.push(["split-window", "-d", "-c", pane.directory, pane.command])
    steps.push(["select-layout", input.layout])
    return steps
  }
  const first = input.panes[0]
  steps.push(["new-session", "-d", "-s", input.name, "-c", first.directory, first.command])
  for (const pane of input.panes.slice(1))
    steps.push(["split-window", "-d", "-t", input.name, "-c", pane.directory, pane.command])
  steps.push(["select-layout", "-t", input.name, input.layout])
  if (input.attach) steps.push(["attach-session", "-t", input.name])
  return steps
}

export const MuxCommand = effectCmd({
  command: "mux [dirs..]",
  describe: "run parallel bolt sessions in tmux split panes",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("dirs", {
        describe: "directories to open, one pane each (defaults to --count panes in the current directory)",
        type: "string",
        array: true,
        default: [] as string[],
      })
      .option("count", {
        alias: ["n"],
        type: "number",
        default: 2,
        describe: "number of panes when no directories are given",
      })
      .option("layout", {
        type: "string",
        choices: LAYOUTS,
        default: "tiled" as (typeof LAYOUTS)[number],
        describe: "tmux layout for the panes",
      })
      .option("name", {
        type: "string",
        default: "bolt",
        describe: "tmux session name when starting outside tmux",
      }),
  handler: Effect.fn("Cli.mux")(function* (args) {
    const tmux = Bun.which("tmux")
    if (!tmux)
      return yield* fail(
        "bolt mux requires tmux and it was not found on PATH. Install tmux (https://github.com/tmux/tmux/wiki/Installing) and retry.",
      )
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > 16)
      return yield* fail("--count must be an integer between 1 and 16")
    const cwd = process.cwd()
    const dirs = args.dirs.map((dir) => path.resolve(cwd, dir))
    for (const dir of dirs) {
      const exists = yield* Effect.promise(() => Filesystem.exists(dir))
      if (!exists) return yield* fail(`Directory not found: ${dir}`)
    }
    const inside = !!process.env.TMUX
    const attach = !inside && process.stdout.isTTY === true
    if (!inside) {
      const probe = Bun.spawnSync([tmux, "has-session", "-t", args.name], { stdout: "ignore", stderr: "ignore" })
      if (probe.exitCode === 0)
        return yield* fail(
          `tmux session '${args.name}' already exists. Attach with: tmux attach -t ${args.name}, or pass --name.`,
        )
    }
    const list = panes({ dirs, count: args.count, cwd, command: "bolt" })
    const steps = plan({ panes: list, inside, name: args.name, layout: args.layout, attach })
    for (const step of steps) {
      const result = Bun.spawnSync([tmux, ...step], { stdin: "inherit", stdout: "inherit", stderr: "pipe" })
      if (result.exitCode !== 0)
        return yield* fail(`tmux ${step[0]} failed: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`)
    }
    if (!attach && !inside) UI.println(`Started tmux session '${args.name}'. Attach with: tmux attach -t ${args.name}`)
  }),
})
