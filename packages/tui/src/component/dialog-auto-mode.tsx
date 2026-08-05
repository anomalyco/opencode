import { createMemo, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { applyAutoMode } from "./auto-mode-apply"
import { currentAutoMode, MODES, type ModeValue } from "../util/auto-mode"

export { currentAutoMode }

export function DialogAutoMode() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  const active = createMemo(() =>
    currentAutoMode(sync.data.config.auto_mode ?? false, sync.data.config.auto_continue ?? false),
  )

  const options = createMemo(() =>
    MODES.map((mode) => ({
      title: mode.value === active() ? `${mode.title}  ✓ current` : mode.title,
      value: mode.value,
      footer: mode.footer,
    })),
  )

  onMount(() => {
    dialog.setSize("medium")
  })

  return (
    <DialogSelect
      title="Auto mode"
      options={options()}
      skipFilter={true}
      onSelect={async (option) => {
        dialog.clear()
        await applyAutoMode({ sdk, sync, toast }, option.value as ModeValue)
      }}
    />
  )
}
