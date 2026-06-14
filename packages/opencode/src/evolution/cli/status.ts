import { EOL } from "os"
import { Effect, Option } from "effect"
import { effectCmd } from "@/cli/effect-cmd"
import { Evolution } from "@/evolution/index"

const SCHEMA_VERSION = 1

const label = (key: string, val: string) => `  ${key}: ${val}`

function formatStatus(status: {
  mode: string
  enabled: boolean
  memory: { count: number; lastUpdate: number | null }
  decisions: { count: number }
  project: { detected: boolean; root: string; frameworks: string[] }
}): string {
  const lines: string[] = []
  lines.push(`Evolution Layer  (schema v${SCHEMA_VERSION})` + EOL)

  if (!status.enabled) {
    lines.push("  Status: disabled")
    lines.push("  Enable with: evolution.enabled: true in opencode.jsonc" + EOL)
    return lines.join(EOL)
  }

  lines.push(`  Status: active · Mode: ${status.mode}`)

  if (status.project.detected) {
    lines.push("")
    lines.push("Project:")
    const name = status.project.root.split(/[/\\]/).pop() || "unknown"
    lines.push(label("Name", name))
    const frameworks = status.project.frameworks
    lines.push(label("Frameworks", frameworks.length > 0 ? frameworks.join(", ") : "none detected"))
  }

  lines.push("")
  lines.push("Architecture Decisions:")
  lines.push(label("Count", String(status.decisions.count)))
  if (status.decisions.count > 0) {
    const plural = status.decisions.count === 1 ? "" : "s"
    lines.push(`  ${status.decisions.count} active decision${plural}`)
  } else {
    lines.push("  no decisions recorded")
  }

  lines.push("")
  lines.push("Memory:")
  lines.push(label("Entries", String(status.memory.count)))
  if (status.memory.lastUpdate) {
    lines.push(label("Last Update", new Date(status.memory.lastUpdate).toISOString()))
  } else {
    lines.push("  no memory entries")
  }

  return lines.join(EOL)
}

export const StatusCommand = effectCmd({
  command: "status",
  describe: "show Evolution Layer status",
  instance: true,
  handler: Effect.fn("Cli.evolution.status")(function* () {
    const svc = yield* Effect.serviceOption(Evolution.Service)

    if (Option.isNone(svc)) {
      process.stdout.write(
        formatStatus({
          mode: "observe",
          enabled: false,
          memory: { count: 0, lastUpdate: null },
          decisions: { count: 0 },
          project: { detected: false, root: "", frameworks: [] },
        }) + EOL,
      )
      return
    }

    const status = yield* svc.value.status().pipe(
      Effect.catchTag("EvolutionStorageError", () =>
        Effect.sync(() => ({
          mode: "observe" as const,
          enabled: false,
          memory: { count: 0, lastUpdate: null },
          decisions: { count: 0 },
          project: { detected: false, root: "", frameworks: [] },
        })),
      ),
    )
    process.stdout.write(formatStatus(status) + EOL)
  }),
})

export * as EvolutionStatus from "./status"
