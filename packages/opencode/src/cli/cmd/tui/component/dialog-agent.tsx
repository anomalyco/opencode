import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogModel } from "./dialog-model"
import type { Keybind } from "@/util"

const ctrlE: Keybind.Info = { name: "e", ctrl: true, meta: false, shift: false, super: false, leader: false }

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => {
    // Show all visible agents (including subagents) so users can edit their models
    return local.agent.allVisible().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.model
          ? `${item.model.providerID}/${item.model.modelID}`
          : item.native
            ? "native — (default)"
            : item.description ?? "(default)",
      }
    })
  })

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.name}
      options={options()}
      keybind={[
        {
          keybind: ctrlE,
          title: "Edit model",
          onTrigger: (option) => {
            dialog.replace(() => <DialogModel assignToAgent={option.value as string} />)
          },
        },
      ]}
      onSelect={(option) => {
        // Prevent selecting subagents as the primary active agent
        if (local.agent.allVisible().find((x) => x.name === option.value)?.mode === "subagent") {
          return
        }
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
