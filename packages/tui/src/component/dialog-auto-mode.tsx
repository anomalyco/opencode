import { createMemo, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { applyAutoMode } from "./auto-mode-apply"
import { DialogPrompt } from "../ui/dialog-prompt"
import { currentAutoMode, liveQueueRuns, modeSpec, MODES, type ModeValue } from "../util/auto-mode"

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
        const value = option.value as ModeValue
        // Entering Auto commits the agent to hours of unattended work, so it
        // asks once rather than starting on a keystroke. The instruction is
        // optional and steers HOW the work is done — what gets worked is still
        // decided by the checkboxes on disk, which is what makes the run
        // trustworthy. Leaving Auto, or any mode that starts nothing, is
        // immediate.
        if (!modeSpec(value).queue) {
          dialog.clear()
          await applyAutoMode({ sdk, sync, toast }, value)
          return
        }
        const running = liveQueueRuns((await sdk.client.loop.list()).data ?? []).length > 0
        if (running) {
          dialog.clear()
          await applyAutoMode({ sdk, sync, toast }, value)
          return
        }
        dialog.replace(() => (
          <DialogPrompt
            title="Auto — work the openspec backlog"
            placeholder="Optional: a standing instruction for every iteration (leave blank to just go)"
            description={() => (
              <text>
                Works every eligible change through implement, test, verify and commit. Never pushes. Type a message
                any time to take over.
              </text>
            )}
            onConfirm={async (text) => {
              dialog.clear()
              await applyAutoMode({ sdk, sync, toast }, value, text)
            }}
            onCancel={() => dialog.clear()}
          />
        ))
      }}
    />
  )
}
