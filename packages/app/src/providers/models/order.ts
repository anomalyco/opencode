import { compareModelOrder } from "@opencode-ai/util/model-order"

type ModelOrderItem = {
  provider: { id: string }
  cost?: { input: number }
  release_date?: string
  name: string
}

export const isFreeModel = (item: Pick<ModelOrderItem, "provider" | "cost">) =>
  item.provider.id === "opencode" && (!item.cost || item.cost.input === 0)

export const compareModels = (a: ModelOrderItem, b: ModelOrderItem) =>
  compareModelOrder(
    { free: isFreeModel(a), released: Date.parse(a.release_date ?? "") || 0, name: a.name },
    { free: isFreeModel(b), released: Date.parse(b.release_date ?? "") || 0, name: b.name },
  )
