import type { AssistantMessage, Message, Model } from "@opencode-ai/sdk/v2"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const credits = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatSessionCost(cost: number, messages: readonly Message[]) {
  const assistants = messages.filter((item): item is AssistantMessage => item.role === "assistant")
  const total = assistants.reduce((sum, item) => sum + item.cost, 0)
  // A partial history cannot establish the provider of the whole session total.
  const complete = Math.abs(total - cost) <= 1e-8 * Math.max(total, cost, Number.EPSILON)
  if (
    complete &&
    assistants.length > 0 &&
    assistants.every((item) => item.providerID === "github-copilot" || item.providerID === "github-copilot-enterprise")
  ) {
    return `${credits.format(cost * 100)} AI credits`
  }
  return money.format(cost)
}

export function contextLimit(model: Pick<Model, "limit" | "options" | "variants"> | undefined, variant?: string) {
  if (!model) return undefined
  const budgets = model.options.copilotContext
  if (!budgets || typeof budgets !== "object" || !("default" in budgets) || !("long" in budgets))
    return model.limit.context
  const tier =
    variant?.endsWith("@long") || model.variants?.[variant ?? ""]?.copilotContextTier === "long" ? "long" : "default"
  const input = budgets[tier]
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return model.limit.context
  return Math.min(model.limit.context, input + model.limit.output)
}
