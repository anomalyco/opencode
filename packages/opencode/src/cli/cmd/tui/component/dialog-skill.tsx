import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { Keybind } from "@/util/keybind"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"

export type DialogSkillProps = {
  readonly onSelect: (skill: string) => void
}

function Status(props: { readonly enabled: boolean; readonly loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const [loading, setLoading] = createSignal<string | null>(null)
  dialog.setSize("large")

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const skillData = sync.data.skill
    const loadingSkill = loading()
    const list = Object.entries(skillData)
    const max = Math.max(0, ...list.map(([name]) => name.length))
    return list.map(([name, entry]) => ({
      title: name.padEnd(max),
      description: entry.description?.replaceAll(/\s+/g, " ").trim(),
      value: name,
      category: "Skills",
      footer: <Status enabled={local.skill.isEnabled(name)} loading={loadingSkill === name} />,
      onSelect: () => {
        props.onSelect(name)
        dialog.clear()
      },
    }))
  })

  return (
    <DialogSelect
      title="Skills"
      placeholder="Search skills..."
      options={options()}
      keybind={[
        {
          keybind: Keybind.parse("space")[0],
          title: "toggle",
          disabled: loading() !== null,
          onTrigger: async (option) => {
            if (loading() !== null) return
            const name = option.value
            const state = sync.data.skill[name]?.status ?? "enabled"

            setLoading(name)
            try {
              await local.skill.toggle(name, state === "enabled")
              const result = await sdk.client.skill.status({}, { throwOnError: true })
              if (result.data) {
                for (const [skillName, status] of Object.entries(result.data)) {
                  sync.set("skill", skillName, status)
                }
              }
            } catch (err) {
              console.error("Failed to toggle skill:", err)
            } finally {
              setLoading(null)
            }
          },
        },
      ]}
    />
  )
}
