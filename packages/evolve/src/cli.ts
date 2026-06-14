#!/usr/bin/env bun
import { writeFileSync } from "node:fs"
import { loadSkill } from "./skill.ts"
import { loadDataset } from "./dataset.ts"
import { AnthropicClient, MockLLMClient, type LLMClient } from "./llm.ts"
import { keywordScorer, llmJudgeScorer, type Scorer } from "./evaluate.ts"
import { offlineResponder } from "./offline.ts"
import { evolveSkill } from "./gepa.ts"
import { renderReport } from "./report.ts"
import { deployBest } from "./deploy.ts"

interface Args {
  skill?: string
  dataset?: string
  generations: number
  population: number
  out?: string
  write: boolean
  mock: boolean
  judge: boolean
  model?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { generations: 3, population: 2, write: false, mock: false, judge: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case "--skill":
        args.skill = next()
        break
      case "--dataset":
        args.dataset = next()
        break
      case "--generations":
        args.generations = Number(next())
        break
      case "--population":
        args.population = Number(next())
        break
      case "--out":
        args.out = next()
        break
      case "--write":
        args.write = true
        break
      case "--mock":
        args.mock = true
        break
      case "--judge":
        args.judge = true
        break
      case "--model":
        args.model = next()
        break
      case "-h":
      case "--help":
        printHelp()
        process.exit(0)
    }
  }
  return args
}

function printHelp() {
  console.log(
    [
      "evolve — trace-reflective skill self-evolution (GEPA-style)",
      "",
      "Usage:",
      "  evolve run --skill <SKILL.md> --dataset <dataset.json> [options]",
      "",
      "Options:",
      "  --generations <n>   number of generations (default 3)",
      "  --population <n>    variants per parent per generation (default 2)",
      "  --out <file>        write the markdown report to <file>",
      "  --write             write the winning variant back to the skill file (only if improved)",
      "  --judge             use an LLM judge scorer (requires credentials)",
      "  --mock              use the deterministic offline model (no credentials needed)",
      "  --model <id>        Anthropic model id (default claude-sonnet-4-6 / $EVOLVE_MODEL)",
      "",
      "Without --mock, set ANTHROPIC_API_KEY (and optionally ANTHROPIC_BASE_URL).",
    ].join("\n"),
  )
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd !== "run") {
    printHelp()
    process.exit(cmd ? 1 : 0)
  }
  const args = parseArgs(rest)
  if (!args.skill || !args.dataset) {
    console.error("error: --skill and --dataset are required\n")
    printHelp()
    process.exit(1)
  }

  const skill = loadSkill(args.skill)
  const dataset = loadDataset(args.dataset)

  const useMock = args.mock || !process.env.ANTHROPIC_API_KEY
  const llm: LLMClient = useMock
    ? new MockLLMClient(offlineResponder(dataset))
    : new AnthropicClient({ model: args.model })
  if (useMock && !args.mock) {
    console.error("note: no ANTHROPIC_API_KEY found — falling back to the deterministic offline model\n")
  }

  const scorer: Scorer = args.judge && !useMock ? llmJudgeScorer(llm) : keywordScorer()

  const run = await evolveSkill({
    skill,
    dataset,
    llm,
    scorer,
    config: {
      generations: args.generations,
      population: args.population,
      onGeneration: (g) =>
        console.error(`gen ${g.generation}: proposed ${g.evaluated.length}, frontier ${g.frontier.length}, best ${g.best}`),
    },
  })

  const report = renderReport(run)
  if (args.out) {
    writeFileSync(args.out, report, "utf8")
    console.error(`report written to ${args.out}`)
  } else {
    console.log(report)
  }

  if (args.write) {
    const result = deployBest(run, skill, args.skill)
    console.error(result.changed ? `skill updated: ${result.path}` : "skill unchanged (no improvement)")
  }

  process.exit(run.improvedFromBaseline ? 0 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})
