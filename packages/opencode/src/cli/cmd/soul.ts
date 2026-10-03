// opencode soul — constitution layer commands.
//   opencode soul validate            load SOUL.md + suite for this project and run the entry lint
//   opencode soul eval --suite S --responses R [--baseline B] [--report report.md]
//                                     deterministic eval: grade responses, check gates, print report

import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { Path as GlobalPath } from "@opencode-ai/core/global"
import { Soul } from "@/soul/soul"
import { SoulEval } from "@/soul/eval"
import path from "path"

function findSoulFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, Soul.FILENAME)
    if (Bun.file(candidate).size > 0) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const globalCandidate = path.join(GlobalPath.config, Soul.FILENAME)
  if (Bun.file(globalCandidate).size > 0) return globalCandidate
  return undefined
}

export const SoulValidateCommand = effectCmd({
  command: "validate",
  describe: "validate SOUL.md and its paired probe suite for this project",
  handler: Effect.fn("Cli.soul.validate")(function* () {
    const ctx = yield* InstanceRef
    const directory = ctx?.directory ?? process.cwd()
    const filepath = findSoulFile(directory)
    if (!filepath) return yield* fail(`no ${Soul.FILENAME} found (looked up from ${directory} and ${GlobalPath.config})`)
    const content = yield* Effect.tryPromise({
      try: () => Bun.file(filepath).text(),
      catch: (cause) => new Error(`cannot read ${filepath}: ${cause}`),
    }).pipe(Effect.catch((err) => fail(err.message)))
    let soul: Soul.SoulFile
    try {
      soul = Soul.parseSoul(content, filepath)
    } catch (cause) {
      return yield* fail(`cannot parse ${filepath}: ${cause}`)
    }
    const suiteFile = Bun.file(soul.suitePath)
    if (suiteFile.size === 0)
      return yield* fail(
        `soul: eval suite not found at ${soul.suitePath}; every soul needs a paired probe suite`,
        2,
      )
    const suiteText = yield* Effect.tryPromise({
      try: () => suiteFile.text(),
      catch: (cause) => new Error(`cannot read ${soul.suitePath}: ${cause}`),
    }).pipe(Effect.catch((err) => fail(err.message)))
    let suite: SoulEval.Suite
    try {
      suite = SoulEval.parseSuite(suiteText)
    } catch (cause) {
      return yield* fail(`cannot parse suite ${soul.suitePath}: ${cause}`, 2)
    }
    const errs = Soul.entryLint(soul, suite)
    if (errs.length > 0) return yield* fail(errs.join("\n"), 1)
    console.log(
      `soul valid: ${filepath} (${soul.axioms.length} axioms, suite ${soul.suitePath})`,
    )
  }),
})

export const SoulEvalCommand = effectCmd({
  command: "eval",
  describe: "deterministically score soul probe responses and check the release gates",
  builder: (yargs) =>
    yargs
      .option("suite", { describe: "path to the soul eval suite YAML", type: "string" })
      .option("responses", { describe: "path to probe responses JSONL", type: "string" })
      .option("baseline", { describe: "path to a frozen baseline JSON for drift diff", type: "string" })
      .option("report", { describe: "write the markdown report to this path", type: "string" })
      .demandOption(["suite", "responses"]),
  instance: false,
  handler: Effect.fn("Cli.soul.eval")(function* (args) {
    const read = (p: string, label: string) =>
      Effect.tryPromise({
        try: async () => {
          const f = Bun.file(p)
          if (f.size === 0) throw new Error(`${label} not found: ${p}`)
          return f.text()
        },
        catch: (cause) => new Error(String(cause)),
      }).pipe(Effect.catch((err) => fail(err.message, 2)))

    const suiteText = yield* read(args.suite!, "suite")
    const responsesText = yield* read(args.responses!, "responses")
    const baselineText = args.baseline ? yield* read(args.baseline, "baseline") : undefined

    let suite: SoulEval.Suite
    try {
      suite = SoulEval.parseSuite(suiteText)
    } catch (cause) {
      return yield* fail(`suite is not valid: ${cause}`, 2)
    }
    const lintErrs = SoulEval.lintSuite(suite)
    if (lintErrs.length > 0) return yield* fail(`suite lint failed:\n${lintErrs.join("\n")}`, 2)

    let responses: Record<string, SoulEval.Response>
    try {
      responses = SoulEval.parseResponses(responsesText)
    } catch (cause) {
      return yield* fail(`responses are not valid: ${cause}`, 2)
    }
    const baseline: SoulEval.Baseline | undefined = baselineText ? JSON.parse(baselineText) : undefined

    const { report, gates } = SoulEval.scoreAll(suite, responses, baseline)
    if (args.report) {
      yield* Effect.tryPromise({
        try: () => Bun.write(args.report!, report),
        catch: (cause) => new Error(`cannot write report: ${cause}`),
      }).pipe(Effect.catch((err) => fail(err.message, 2)))
      console.log(`report -> ${args.report}`)
    } else {
      console.log(report)
    }
    const blocking = gates.filter((g) => g.blocking)
    if (blocking.length > 0)
      return yield* fail(`BLOCKED by ${blocking.length} gate(s): ${blocking.map((g) => g.gate).join(", ")}`, 1)
    console.log("\nAll gates pass.")
  }),
})

export const SoulCommand = cmd({
  command: "soul",
  describe: "soul constitution layer: validate the soul file, run deterministic evals",
  builder: (yargs) => yargs.command(SoulValidateCommand).command(SoulEvalCommand).demandCommand(),
  async handler() {},
})
