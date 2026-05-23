import { createMemo } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"

type ConfigOption = {
  id: string
  name: string
  description?: string
  currentValue: string
  type: string
  category?: string
  options: Array<{ value: string; name: string; description?: string }>
}

export function DialogAcpConfig() {
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const configOptions = createMemo(() => {
    const state = sessionID() ? sync.data.acp[sessionID()!] : undefined
    if (state?.configOptions?.length) return state.configOptions
    const modes = state?.modes
    const models = state?.models
    return [
      ...(modes?.availableModes
        ? [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              currentValue: modes.currentModeId,
              options: modes.availableModes.map((mode: any) => ({
                value: mode.id,
                name: mode.name,
                description: mode.description,
              })),
            },
          ]
        : []),
      ...(models?.availableModels
        ? [
            {
              id: "model",
              name: "Model",
              type: "select",
              currentValue: models.currentModelId,
              options: models.availableModels.map((model: any) => ({
                value: model.modelId,
                name: model.name,
              })),
            },
          ]
        : []),
    ]
  })
  const options = createMemo(() => {
    return configOptions()
      .filter((item): item is ConfigOption => item?.type === "select" && Array.isArray(item.options))
      .flatMap((item) =>
        item.options.map((option) => ({
          value: { configID: item.id, value: option.value },
          title: option.name,
          description: option.description ?? item.description,
          category: item.name,
          footer: item.currentValue === option.value ? "Current" : undefined,
          onSelect: async () => {
            const id = sessionID()
            if (!id) return
            const url = new URL(`/session/${id}/acp/config`, sdk.url)
            const response = await sdk.fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ configID: item.id, value: option.value }),
            })
            if (!response.ok) {
              toast.show({ variant: "error", message: "Failed to set ACP option", duration: 3000 })
              return
            }
            dialog.clear()
          },
        })),
      )
  })

  return <DialogSelect options={options()} title="ACP options" flat={true} />
}
