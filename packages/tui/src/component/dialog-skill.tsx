import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createResource, createMemo, createSignal } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
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
      // Catch so the rejected resource never reaches the memo below: reading
      // skills() in an errored state re-throws and tears down the dialog.
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )

  const showError = createMemo(() => Boolean(loadError()))

  const recentNames = createMemo(() => getTopRecentSkills(5))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (showError()) return []
    const list = skills() ?? []
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))

    const recentOpts: DialogSelectOption<string>[] = recentNames().map((name) => ({
      title: name.padEnd(maxWidth),
      description: undefined,
      value: name,
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
      category: "Skills",
      onSelect: () => {
        recordSkillUsage(skill.name)
        props.onSelect(skill.name)
        dialog.clear()
      },
    }))

    return [...recentOpts, ...allOpts]
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
    />
  )
}
