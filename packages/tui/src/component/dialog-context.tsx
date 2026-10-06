import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

export function DialogContext() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const options = createMemo(() => {
    const selected = local.model.current()
    const model = sync.data.provider.find((p) => p.id === selected?.providerID)?.models[selected?.modelID ?? ""]
    const budgets = local.model.context.budgets()
    if (!model || !budgets) return []
    return (["default", "long"] as const).map((tier) => {
      const cost = tier === "long" ? (model.cost.tiers?.[0] ?? model.cost) : model.cost
      return {
        value: tier,
        title: `${tier === "long" ? "Long" : "Default"}, ${budgets[tier] / 1000}K input`,
        description: `${cost.input * 100}/${cost.output * 100} credits per 1M in/out`,
        onSelect() {
          local.model.context.set(tier)
          dialog.clear()
        },
      }
    })
  })
  return <DialogSelect options={options()} title="Select context window" current={local.model.context.current()} flat />
}
