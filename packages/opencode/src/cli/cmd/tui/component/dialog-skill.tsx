import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createMemo, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSkillCatalog } from "@tui/context/skills"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const skillCatalog = useSkillCatalog()
  dialog.setSize("large")
  onMount(() => {
    void skillCatalog.refresh()
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list = skillCatalog.skills()
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      category: "Skills",
      onSelect: () => {
        props.onSelect(skill.name)
        dialog.clear()
      },
    }))
  })

  return <DialogSelect title="Skills" placeholder="Search skills..." options={options()} />
}
