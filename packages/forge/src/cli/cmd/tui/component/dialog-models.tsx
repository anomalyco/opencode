import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

/**
 * ACP Model Selection Dialog
 *
 * Displays available models from the ACP agent and allows switching between them.
 */
export function DialogModels() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => {
    const models = local.model.list()

    return models.map((model) => ({
      value: model.modelId,
      title: model.name ?? model.modelId,
      description: model.description ?? "",
      onSelect() {
        dialog.clear()
        local.model.set(model.modelId)
      },
    }))
  })

  return (
    <DialogSelect
      title="Select model"
      current={local.model.current()}
      options={options()}
    />
  )
}
