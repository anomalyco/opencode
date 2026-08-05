import { createMemo, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"

// The four states are two independent switches (auto_mode = skip permission
// prompts, auto_continue = keep working after a turn). Cycling a keybind until
// the indicator happens to read the right thing is not a way to change a
// setting you care about, so this names every state and what it does, marks
// the one you are in, and lets you pick.
type ModeValue = "manual" | "skip-ask" | "continue" | "auto"

const MODES: { value: ModeValue; title: string; footer: string; auto_mode: boolean; auto_continue: boolean }[] = [
  {
    value: "manual",
    title: "Manual",
    footer: "Asks before risky tools. Stops at the end of every turn.",
    auto_mode: false,
    auto_continue: false,
  },
  {
    value: "skip-ask",
    title: "Skip-ask",
    footer: "Approves prompts that would have asked. Still stops at the end of every turn.",
    auto_mode: true,
    auto_continue: false,
  },
  {
    value: "continue",
    title: "Continue",
    footer: "Keeps working after a turn, but still asks before risky tools.",
    auto_mode: false,
    auto_continue: true,
  },
  {
    value: "auto",
    title: "Auto",
    footer: "Both: approves what would have asked, and keeps working. Deny rules still hold.",
    auto_mode: true,
    auto_continue: true,
  },
]

export function currentAutoMode(auto_mode: boolean, auto_continue: boolean): ModeValue {
  if (auto_mode && auto_continue) return "auto"
  if (auto_mode) return "skip-ask"
  if (auto_continue) return "continue"
  return "manual"
}

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
        const mode = MODES.find((item) => item.value === option.value)
        if (!mode) return
        dialog.clear()
        try {
          await sdk.client.global.config.update(
            { config: { auto_mode: mode.auto_mode, auto_continue: mode.auto_continue } },
            { throwOnError: true },
          )
          const refreshed = await sdk.client.global.config.get({ throwOnError: true })
          sync.set("config", refreshed.data!)
          toast.show({ variant: "success", message: `${mode.title} — ${mode.footer}` })
        } catch {
          toast.show({ variant: "warning", message: "Failed to update auto mode setting" })
        }
      }}
    />
  )
}
