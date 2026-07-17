import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createResource, createMemo, createSignal, Match, Switch } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { useData } from "../context/data"
import type { LocationRef } from "@opencode-ai/client"

export type DialogSkillProps = {
  location?: LocationRef
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const data = useData()
  const { themeV2 } = useTheme()
  dialog.setSize("large")

  const [loadError, setLoadError] = createSignal<unknown>()

  const [skills] = createResource(() =>
    Promise.resolve()
      .then(async () => {
        const current = data.location.skill.list(props.location)
        if (current) return current
        await data.location.skill.sync(props.location)
        return data.location.skill.list(props.location) ?? []
      })
      // Catch so the rejected resource never reaches the memo below: reading
      // skills() in an errored state re-throws and tears down the dialog.
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )

  const showError = createMemo(() => Boolean(loadError()))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (showError()) return []
    const list = skills() ?? []
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.id,
      onSelect: () => {
        props.onSelect(skill.id)
        dialog.clear()
      },
    }))
  })

  return (
    <DialogSelect
      title="Skills"
      options={options()}
      renderFilter={!showError() && !skills.loading}
      locked={showError() || skills.loading}
      emptyView={
        <Switch
          fallback={
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={themeV2.text.subdued()}>No skills available</text>
            </box>
          }
        >
          <Match when={showError()}>
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={themeV2.text.feedback.error()} attributes={TextAttributes.BOLD}>
                Could not load skills
              </text>
              <text fg={themeV2.text.subdued()}>{errorMessage(loadError())}</text>
              <text fg={themeV2.text.subdued()}>Close and reopen Skills to try again.</text>
            </box>
          </Match>
          <Match when={skills.loading}>
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={themeV2.text.subdued()}>Loading skills…</text>
            </box>
          </Match>
        </Switch>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={themeV2.text.subdued()}>No skills found</text>
        </box>
      }
    />
  )
}
