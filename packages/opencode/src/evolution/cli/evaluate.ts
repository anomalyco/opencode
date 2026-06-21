import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "@/cli/effect-cmd"
import { Activation } from "@/evolution/decision/activation/index"

export const EvaluateCommand = effectCmd({
  command: "evaluate",
  describe: "[Activation Sprint] run decision engine evaluation — generate proposal from current evidence",
  instance: true,
  handler: Effect.fn("Cli.evolution.evaluate")(function* () {
    const dryRun = process.argv.includes("--dry-run") || process.env.OPENCODE_EVOLUTION_DRY_RUN === "true"
    const result = yield* Activation.invoke({ dryRun }).pipe(
      Effect.catch((e) =>
        Effect.succeed({ outcome: "NO_CANDIDATES" as const, error: String(e) }),
      ),
    )

    if ("error" in result) {
      process.stdout.write(`Evaluation failed: ${result.error}${EOL}`)
      return
    }

    process.stdout.write(`${EOL}=== Decision Evaluation Result ===${EOL}`)
    process.stdout.write(`  Outcome: ${result}${EOL}`)
    process.stdout.write(`${EOL}`)
  }),
})

export * as EvolutionEvaluate from "./evaluate"
