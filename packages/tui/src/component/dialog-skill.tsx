import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createResource, createMemo, createSignal } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  dialog.setSize("large")

  const [loadError, setLoadError] = createSignal<unknown>()
  const [attention, setAttention] = createSignal(0)

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
  const loading = () => skills.loading

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (showError()) return []
    const list = skills() ?? []
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

  return (
    <DialogSelect
      title="Skills"
      placeholder="Search skills..."
      options={loading() ? [] : options()}
      renderFilter={!showError() && !loading()}
      locked={showError() || loading()}
      onEmptySubmit={loading() ? () => setAttention((value) => value + 1) : undefined}
      emptyView={
        loading() ? (
          <box paddingLeft={4} paddingRight={4}>
            <Spinner attention={attention()}>Loading skills</Spinner>
          </box>
        ) : showError() ? (
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
