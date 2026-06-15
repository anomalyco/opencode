import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogSkillDetail } from "./dialog-skill-detail"
import { createResource, createMemo, createSignal } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { useKeyboard } from "@opentui/solid"
import { getTopRecentSkills, recordSkillUsage } from "@opencode-ai/core/util/recent-skills"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  dialog.setSize("large")

  const [loadError, setLoadError] = createSignal<unknown>()

  const [skills] = createResource(() =>
    sdk.client.app
      .skills({}, { throwOnError: true })
      .then((result) => result.data ?? [])
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )

  const showError = createMemo(() => Boolean(loadError()))
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const recentNames = createMemo(() => getTopRecentSkills(5))

  function pushDetail(skillName: string) {
    const skill = allSkills().find((s) => s.name === skillName)
    if (!skill) return
    dialog.push(() => (
      <DialogSkillDetail
        name={skill.name}
        description={skill.description}
        template={skill.content}
        onSelect={props.onSelect}
      />
    ))
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (showError()) return []
    const list = skills() ?? []
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))

    const recentOpts: DialogSelectOption<string>[] = recentNames().map((name) => ({
      title: name.padEnd(maxWidth),
      description: undefined,
      value: name,
      trailing: " ›",
      onTrailingClick: () => pushDetail(name),
      category: "Recently Used",
      onSelect: () => {
        recordSkillUsage(name)
        props.onSelect(name)
        dialog.clear()
      },
    }))

    const allOpts: DialogSelectOption<string>[] = list.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      trailing: " ›",
      onTrailingClick: () => pushDetail(skill.name),
      category: "Skills",
      onSelect: () => {
        recordSkillUsage(skill.name)
        props.onSelect(skill.name)
        dialog.clear()
      },
    }))

    return [...recentOpts, ...allOpts]
  })

  const allSkills = createMemo(() => {
    const list = skills() ?? []
    return list
  })

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "o") {
      evt.preventDefault()
      evt.stopPropagation()
      const idx = selectedIndex()
      const opts = options()
      if (idx < 0 || idx >= opts.length) return
      pushDetail(opts[idx].value)
    }
  })

  return (
    <DialogSelect
      title="Skills"
      placeholder="Search skills..."
      options={options()}
      renderFilter={!showError()}
      locked={showError()}
      emptyView={
        showError() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Could not load skills
            </text>
            <text fg={theme.textMuted}>{errorMessage(loadError())}</text>
          </box>
        ) : undefined
      }
      selectedIndex={selectedIndex()}
      onIndexChange={(index) => setSelectedIndex(index)}
    />
  )
}
