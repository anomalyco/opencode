import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const FILE = path.join(".bolt", "quarantine.json")

export type Quarantined = {
  command: string
  passes: number
  runs: number
  detected: number
}

/** Classify a series of exit codes from repeated runs. */
export function verdict(codes: number[]) {
  if (codes.length === 0) return undefined
  const passes = codes.filter((code) => code === 0).length
  if (passes === codes.length) return "pass" as const
  if (passes === 0) return "fail" as const
  return "flaky" as const
}

export const FlakyCommand = effectCmd({
  command: "flaky <command>",
  describe: "detect flaky tests by rerunning a command, and quarantine offenders",
  builder: (yargs) =>
    yargs
      .positional("command", {
        type: "string",
        demandOption: true,
        describe: 'test command to rerun, e.g. "bun test ./test/foo.test.ts"',
      })
      .option("runs", {
        alias: "n",
        type: "number",
        default: 10,
        describe: "number of repetitions",
      })
      .option("quarantine", {
        alias: "q",
        type: "boolean",
        default: false,
        describe: "record the command in .bolt/quarantine.json when it turns out flaky",
      }),
  handler: Effect.fn("Cli.flaky")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree
    const command = args.command
    const runs = Math.max(1, Math.floor(args.runs))

    const execute = () => {
      const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]
      const proc = Bun.spawn(shell, { cwd, stdout: "ignore", stderr: "ignore" })
      return proc.exited
    }

    UI.println(`Running "${command}" ${runs} times...`)
    const codes: number[] = []
    for (let index = 0; index < runs; index++) {
      const code = yield* Effect.promise(execute)
      codes.push(code)
      UI.println(`  run ${index + 1}/${runs}: ${code === 0 ? "pass" : `fail (exit ${code})`}`)
    }

    const passes = codes.filter((code) => code === 0).length
    const outcome = verdict(codes)
    UI.empty()
    UI.println(`${passes}/${runs} passed.`)

    if (outcome === "pass") {
      UI.println("Verdict: stable pass. Not flaky.")
      return
    }
    if (outcome === "fail") {
      UI.println("Verdict: stable fail. This is a real failure, not flakiness.")
      process.exitCode = 1
      return
    }

    UI.println("Verdict: FLAKY. The same command both passed and failed.")
    process.exitCode = 2
    if (!args.quarantine) {
      UI.println(`Record it with: bolt flaky "${command}" --quarantine`)
      return
    }

    const file = path.join(cwd, FILE)
    const existing: Quarantined[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : []
    const entry: Quarantined = { command, passes, runs, detected: Date.now() }
    const merged = [...existing.filter((item) => item.command !== command), entry]
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`)
    UI.println(`Quarantined in ${FILE} (${merged.length} entr${merged.length === 1 ? "y" : "ies"}).`)
  }),
})
