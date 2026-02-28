import { createMemo, createSignal } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"

function Status(props: { disabled: boolean; saving: boolean }) {
  const { theme } = useTheme()
  if (props.saving) {
    return <span style={{ fg: theme.textMuted }}>⋯ Saving</span>
  }
  if (props.disabled) {
    return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
  }
  return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
}

export function DialogTools() {
  const sdk = useSDK()
  const sync = useSync()
  const [saving, setSaving] = createSignal<string | null>(null)

  async function toggle(option: DialogSelectOption<string>) {
    if (saving() !== null) return
    setSaving(option.value)
    try {
      const result = await sdk.client.tools.toggle({ name: option.value })
      if (result.data) {
        sync.set("tools", (prev) => prev.map((t) => (t.name === option.value ? { ...t, disabled: result.data!.disabled } : t)))
      }
    } catch (error) {
      console.error("Failed to toggle tool:", error)
    } finally {
      setSaving(null)
    }
  }

  const options = createMemo(() => {
    const toolList = [...sync.data.tools].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    const savingTool = saving()

    return toolList.map((tool) => ({
      value: tool.name,
      title: tool.name,
      category: tool.category,
      footer: <Status disabled={tool.disabled} saving={savingTool === tool.name} />,
    }))
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: toggle,
    },
  ])

  return <DialogSelect title="Tools" options={options()} keybind={keybinds()} onSelect={toggle} />
}
