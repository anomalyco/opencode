import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useKeyboard } from "@opentui/solid"
import { createMemo, Show } from "solid-js"

export type DialogSkillDetailProps = {
  name: string
  description?: string
  template?: string
  onSelect: (skill: string) => void
}

export function DialogSkillDetail(props: DialogSkillDetailProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const hasTemplate = createMemo(() => !!props.template)

  useKeyboard((evt) => {
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      props.onSelect(props.name)
      dialog.clear()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="column" paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.name}
          </text>
          <text fg={theme.textMuted}>enter: use · esc: back</text>
        </box>
        <Show when={props.description}>
          <box paddingTop={1}>
            <text fg={theme.textMuted} wrapMode="word">
              {props.description}
            </text>
          </box>
        </Show>
      </box>
      <Show when={hasTemplate()}>
        <box flexGrow={1} flexShrink={1} maxHeight={20}>
          <scrollbox
            paddingLeft={4}
            paddingRight={4}
            scrollbarOptions={{ visible: true }}
          >
            <text fg={theme.text} wrapMode="word">
              {props.template}
            </text>
          </scrollbox>
        </box>
      </Show>
      <Show when={!hasTemplate()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>No template available</text>
        </box>
      </Show>
    </box>
  )
}
