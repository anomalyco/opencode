import { EOL } from "os"
import { Effect } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Provider } from "@/provider/provider"

export const ModelsCommand = effectCmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.models")(function* (args) {
    const { Provider } = yield* Effect.promise(() => import("@/provider/provider"))
    if (args.refresh) {
      yield* ModelsDev.Service.use((s) => s.refresh(true))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    const provider = yield* Provider.Service
    const providers = yield* provider.list()

    const ids = Object.keys(providers).sort((a, b) => {
      const aIsOpencode = a.startsWith("opencode")
      const bIsOpencode = b.startsWith("opencode")
      if (aIsOpencode && !bIsOpencode) return -1
      if (!aIsOpencode && bIsOpencode) return 1
      return a.localeCompare(b)
    })

    let selected = ids
    if (args.provider) {
      const providerID = ProviderV2.ID.make(args.provider)
      if (!providers[providerID]) return yield* fail(`Provider not found: ${args.provider}`)
      selected = [providerID]
    }

    const print = (providerID: ProviderV2.ID) => {
      const p = providers[providerID]
      const sorted = Object.entries(p.models).sort(([a], [b]) => a.localeCompare(b))
      if (args.verbose) {
        process.stdout.write(formatProviderTable(providerID, p.name, sorted) + EOL + EOL)
        return
      }
      for (const [modelID] of sorted) {
        process.stdout.write(`${providerID}/${modelID}`)
        process.stdout.write(EOL)
      }
    }

    for (const providerID of selected) print(ProviderV2.ID.make(providerID))
  }),
})

const HEADERS = ["Model", "Name", "Cost ($/1M in/out)", "Context", "Output", "Capabilities"]

// One table per provider, so a single long model ID cannot widen every other provider's columns.
export function formatProviderTable(
  providerID: string,
  providerName: string,
  models: [string, Provider.Model][],
): string {
  const cells = models.map(([modelID, model]) =>
    [
      `${providerID}/${modelID}`,
      model.name,
      formatCost(providerID, model.cost),
      formatTokens(model.limit.context),
      formatTokens(model.limit.output),
      formatCapabilities(model.capabilities),
    ].map(singleLine),
  )

  // Widths are measured in terminal columns, so wide characters such as CJK still line up.
  const widths = HEADERS.map((header, column) =>
    Math.max(Bun.stringWidth(header), ...cells.map((cell) => Bun.stringWidth(cell[column]))),
  )
  // The last column is left unpadded so no line carries trailing whitespace.
  const row = (cell: string[]) =>
    cell
      .map((value, column) =>
        column === cell.length - 1 ? value : value + " ".repeat(widths[column] - Bun.stringWidth(value)),
      )
      .join("  ")

  const header = row(HEADERS)
  const lines = cells.map(row)
  // The rules span the widest line, which can be a row whose last column outgrows its header.
  const rule = "─".repeat(Math.max(...[header, ...lines].map((line) => Bun.stringWidth(line))))
  return [singleLine(providerName), rule, header, rule, ...lines].join(EOL)
}

// Catalogue names can carry tabs or newlines (some models.dev names end in a tab),
// which would shift a row or split it in two.
function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

// A model prices a base rate plus optional context tiers; the table shows the base rate.
// A model whose config declares no cost is stored as 0, so a zero cost only means free
// for opencode's own models, matching the "Free" label in the TUI model picker.
function formatCost(providerID: string, cost: Provider.Model["cost"]): string {
  if (cost.input === 0 && cost.output === 0) return providerID === "opencode" ? "free" : "-"
  return `${cost.input} / ${cost.output}`
}

function formatTokens(count: number): string {
  if (!count) return "-"
  if (count >= 999_500) return `${trimDecimal(count / 1_000_000)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`
  return String(count)
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

function formatCapabilities(capabilities: Provider.Model["capabilities"]): string {
  const flags: string[] = []
  if (capabilities.reasoning) flags.push("reasoning")
  if (capabilities.toolcall) flags.push("tools")
  if (capabilities.attachment) flags.push("attachments")
  return flags.length ? flags.join(", ") : "-"
}
