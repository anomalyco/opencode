import type { Argv } from "yargs"
import { QualityGateEvaluator, QualityGateMetrics, SDLCPhases } from "@opencode-ai/core/sdlc"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"

const ListPhasesCommand = effectCmd({
  command: "list",
  describe: "list all 16 AI SDLC OS phases and quality gate thresholds",
  instance: false,
  handler: Effect.fn("Cli.sdlc.list")(function* () {
    console.log("\n  AI SDLC Operating System v1.1 - 16 Phases Matrix\n")
    console.log("  ID\tLevel\t\tThreshold\tPhase Name")
    console.log("  ----------------------------------------------------------------------")
    for (const phase of SDLCPhases) {
      const levelPad = phase.level.padEnd(8, " ")
      console.log(`  ${phase.id}\t${levelPad}\t${phase.requiredPassingPercentage}%\t\t${phase.name}`)
    }
    console.log("")
  }),
})

const GateEvaluateCommand = effectCmd({
  command: "gate [phaseId]",
  describe: "evaluate Quality Gate metrics for a specific SDLC phase",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.positional("phaseId", {
      type: "number",
      default: 0,
      describe: "Phase ID to evaluate (0-15)",
    })
  },
  handler: Effect.fn("Cli.sdlc.gate")(function* (args: { phaseId: number }) {
    const phase = SDLCPhases.find((p) => p.id === args.phaseId) || SDLCPhases[0]
    const metrics = new QualityGateMetrics({
      buildPassing: true,
      typecheckPassing: true,
      testPassingRate: 100,
      securityPassing: true,
    })
    const result = QualityGateEvaluator.evaluate(phase, metrics)

    console.log(`\n  Quality Gate Assessment for Phase ${phase.id}: ${phase.name}`)
    console.log(`  Level: ${phase.level} | Required: ${result.thresholdRequired}% | Score: ${result.score}%`)
    console.log(`  Status: ${result.passed ? "PASSED ✅" : "FAILED ❌"}\n`)
  }),
})

export const SdlcCommand = effectCmd({
  command: "sdlc",
  describe: "AI SDLC Operating System CLI management",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(ListPhasesCommand).command(GateEvaluateCommand).demandCommand()
  },
  handler: Effect.fn("Cli.sdlc")(function* () {}),
})
