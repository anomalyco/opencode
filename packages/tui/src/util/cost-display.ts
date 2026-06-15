import { CostDisplay } from "@opencode-ai/core/cost-display"

export function formatCost(usd: number, config?: CostDisplay.Config) {
  return CostDisplay.format(locale(config), usd, config)
}

function locale(config: CostDisplay.Config | undefined) {
  return config?.currency?.trim().toUpperCase() === "CNY" ? "zh-Hans" : "en-US"
}
