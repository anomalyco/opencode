import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, createSignal } from "solid-js"
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

function Status(props: { readonly status: "enabled" | "disabled" }) {
  const { theme } = useTheme()
  if (props.status === "enabled") {
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

  const [data] = createResource(async () => {
    const result = await sdk.client.app.skills({}, { throwOnError: true })
    return result.data ?? []
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list = data() ?? []
    const max = Math.max(0, ...list.map((skill) => skill.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(max),
      description: skill.description?.replaceAll(/\s+/g, " ").trim(),
      value: skill.name,
      category: "Skills",
      footer: <Status status={sync.data.skill[skill.name]?.status ?? "enabled"} />,
      onSelect: () => {
        props.onSelect(skill.name)
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
            const next = state === "enabled" ? "disabled" : "enabled"

            setLoading(name)
            sync.set("skill", name, { status: next })

            try {
              await local.skill.toggle(name, state === "enabled")
              const result = await sdk.client.skill.status({}, { throwOnError: true })
              sync.set("skill", result.data ?? {})
            } catch (err) {
              console.error("Failed to toggle skill:", err)
              const result = await sdk.client.skill.status().catch(() => undefined)
              if (result?.data) sync.set("skill", result.data)
              else sync.set("skill", name, { status: state })
            } finally {
              setLoading(null)
            }
          },
        },
      ]}
    />
  )
}
