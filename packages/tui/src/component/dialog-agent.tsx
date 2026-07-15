import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogModel } from "./dialog-model"
import { Locale } from "../util/locale"
import { useToast } from "../ui/toast"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.name,
        title: Locale.agentLabel(item.name),
        description: item.native ? "native" : item.description,
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.name}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        if (local.model.requiresOwnModel(option.value) && !local.model.hasOwnModel(option.value)) {
          toast.show({
            variant: "warning",
            message: `Select a model for ${Locale.agentLabel(option.value)}`,
            duration: 3000,
          })
          dialog.replace(() => <DialogModel />)
          return
        }
        dialog.clear()
      }}
    />
  )
}
