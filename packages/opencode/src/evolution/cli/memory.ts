import { EOL } from "os"
import { Effect, Option } from "effect"
import { effectCmd } from "@/cli/effect-cmd"
import { Evolution } from "@/evolution/index"
import { effectiveConfidence, isStale, DEFAULT_STALE_THRESHOLD_DAYS } from "@/evolution/brain/memory"

function formatMemoryList(entries: Parameters<typeof effectiveConfidence>[0][], staleDays: number): string {
  if (entries.length === 0) return "  no memory entries" + EOL
  const lines: string[] = []
  for (const e of entries) {
    const ec = effectiveConfidence(e)
    const stale = staleDays > 0 && isStale(e, Date.now(), staleDays)
    const tags = [
      `c:${ec.toFixed(2)}`,
      e.source ? `src:${e.source.type}` : "src:none",
      stale ? "STALE" : null,
      e.verifiedAt ? `v:${new Date(e.verifiedAt).toISOString().slice(0, 10)}` : "unverified",
    ].filter(Boolean)
    lines.push(`  [${e.type}] ${e.content.slice(0, 120)}  (${tags.join(", ")})`)
  }
  return lines.join(EOL) + EOL
}

export const MemoryCommand = effectCmd({
  command: "memory",
  describe: "manage evolution memory entries",
  instance: true,
  handler: Effect.fn("Cli.evolution.memory")(function* () {
    const svc = yield* Effect.serviceOption(Evolution.Service)
    if (Option.isNone(svc)) {
      process.stdout.write("Evolution not available" + EOL)
      return
    }
    const svcVal = svc.value
    const memSvc = svcVal.memory()
    const entries = yield* memSvc.all().pipe(
      Effect.catch(() => Effect.succeed([] as Parameters<typeof effectiveConfidence>[0][])),
    )
    const cfg = yield* svcVal.getConfig().pipe(
      Effect.catch(() => Effect.succeed({} as Parameters<typeof effectiveConfidence>[0][])),
    )
    const staleDays = (cfg as { staleThresholdDays?: number }).staleThresholdDays ?? DEFAULT_STALE_THRESHOLD_DAYS
    process.stdout.write(`\nMemory entries: ${entries.length}` + EOL)
    if (entries.length > 0) {
      process.stdout.write(EOL + formatMemoryList(entries, staleDays))
    }
    const anomalies = yield* memSvc.detectAnomalies().pipe(
      Effect.catch(() => Effect.succeed([])),
    )
    if (anomalies.length > 0) {
      process.stdout.write(EOL + `Anomalies detected: ${anomalies.length}` + EOL)
      for (const a of anomalies) {
        process.stdout.write(`  [${a.signal}] ${a.detail}` + EOL)
      }
    }
  }),
})

export * as EvolutionMemoryCli from "./memory"
