import { Show, type Accessor } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"

export type AskPanelState = {
  visible: boolean
  loading: boolean
  question: string
  response: string
  error: string
}

export const initialAskPanelState: AskPanelState = {
  visible: false,
  loading: false,
  question: "",
  response: "",
  error: "",
}

export function AskPanel(props: { state: Accessor<AskPanelState> }) {
  const { theme } = useTheme()

  return (
    <Show when={props.state().visible}>
      <box
        width="100%"
        maxHeight={12}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.backgroundPanel}
        borderColor={theme.info}
        border={["left", "right"]}
        customBorderChars={SplitBorder.customBorderChars}
      >
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>
            /ask{" "}
          </text>
          <text fg={theme.text}>{props.state().question}</text>
        </box>
        <Show when={props.state().loading}>
          <text fg={theme.textMuted}>[thinking...]</text>
        </Show>
        <Show when={props.state().error}>
          <text fg={theme.error}>{props.state().error}</text>
        </Show>
        <Show when={!props.state().loading && !props.state().error && props.state().response}>
          <text fg={theme.text} wrapMode="word" width="100%">
            {props.state().response}
          </text>
        </Show>
        <text fg={theme.textMuted} marginTop={1}>
          space to dismiss
        </text>
      </box>
    </Show>
  )
}
