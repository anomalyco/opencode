import type { SessionPermissionValidatorConfig } from "@opencode-ai/sdk/v2"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

export function DialogPermissionValidator(props: { sessionID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()

  const options = createMemo(() => [
    {
      value: { mode: "inherit" } satisfies SessionPermissionValidatorConfig,
      title: "Inherit session small model",
      description: "Use the global command-validator model resolution for this session.",
    },
    {
      value: { mode: "disabled" } satisfies SessionPermissionValidatorConfig,
      title: "Disable session validator",
      description: "Skip the LLM check and keep the normal permission prompt.",
    },
    ...sync.data.provider.flatMap((provider) =>
      Object.entries(provider.models)
        .filter(([, model]) => model.status !== "deprecated")
        .map(([modelID, model]) => ({
          value: {
            mode: "model",
            model: `${provider.id}/${modelID}`,
          } satisfies SessionPermissionValidatorConfig,
          title: model.name ?? modelID,
          description: provider.name,
          category: provider.name,
        })),
    ),
  ])

  const current = createMemo<SessionPermissionValidatorConfig>(() => {
    return sync.session.get(props.sessionID)?.permissionValidator ?? { mode: "inherit" }
  })

  async function select(config: SessionPermissionValidatorConfig) {
    try {
      await sdk.client.session.permissionValidator.update(
        { sessionID: props.sessionID, config },
        { throwOnError: true },
      )
      await sync.session.refresh()
      dialog.clear()
    } catch (error) {
      toast.error(error)
    }
  }

  return (
    <DialogSelect
      title="Permission validator"
      options={options()}
      current={current()}
      onSelect={(option) => void select(option.value)}
    />
  )
}
