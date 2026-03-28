import { createMemo, createResource, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Keybind } from "@/util/keybind"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "../context/theme"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

function Status(props: { status: "enabled" | "disabled"; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.status === "enabled") {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const [loading, setLoading] = createSignal<string | null>(null)
  dialog.setSize("large")

  const [data, { refetch }] = createResource(async () => {
    const [skillRes, statusRes] = await Promise.all([sdk.client.app.skills(), sdk.client.skill.status()])
    const status = statusRes.data ?? {}
    return (skillRes.data ?? []).map((skill) => ({
      ...skill,
      state: status[skill.name]?.status ?? "enabled",
    }))
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list = data() ?? []
    const max = Math.max(0, ...list.map((skill) => skill.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(max),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      category: "Skills",
      footer: <Status status={skill.state} loading={loading() === skill.name} />,
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
            const name = option.value
            const match = (data() ?? []).find((item) => item.name === name)
            if (!match) return
            setLoading(name)
            try {
              if (match.state === "enabled") {
                await sdk.client.skill.disable({ name })
              } else {
                await sdk.client.skill.enable({ name })
              }
              await refetch()
            } finally {
              setLoading(null)
            }
          },
        },
      ]}
    />
  )
}
