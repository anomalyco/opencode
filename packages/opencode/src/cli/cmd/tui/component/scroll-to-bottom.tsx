import { Show } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"

export function ScrollNavigationButtons(props: {
  isAtBottom: () => boolean
  onPreviousUserMessage: () => void
  onScrollToBottom: () => void
}) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const topPosition = () => Math.floor(dimensions().height / 2) - 3
  const buttonBg = () => tint(theme.backgroundPanel, theme.primary, 0.15)

  return (
    <box position="absolute" top={topPosition()} right={1} zIndex={100} flexDirection="column" gap={0.5}>
      <box
        backgroundColor={buttonBg()}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
        onMouseDown={(e) => {
          e.stopPropagation()
          props.onPreviousUserMessage()
        }}
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          ▲
        </text>
      </box>
      <Show when={!props.isAtBottom()}>
        <box
          backgroundColor={buttonBg()}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={0}
          paddingBottom={0}
          onMouseDown={(e) => {
            e.stopPropagation()
            props.onScrollToBottom()
          }}
        >
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            ▼
          </text>
        </box>
      </Show>
    </box>
  )
}
