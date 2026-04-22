import { Show } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"

export function ScrollNavigationButtons(props: {
  isScrolledToBottom: boolean | (() => boolean)
  onClickUp: () => void
  onClickDown: () => void
}) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const topPosition = () => Math.floor(dimensions().height / 2) - 3
  const isAtBottom = () =>
    typeof props.isScrolledToBottom === "function" ? props.isScrolledToBottom() : props.isScrolledToBottom

  const buttonBg = () => tint(theme.backgroundPanel, theme.primary, 0.15)

  return (
    <box position="absolute" top={topPosition()} right={1} zIndex={100} flexDirection="column" gap={0.5}>
      <box
        onMouseDown={(e) => {
          e.stopPropagation()
          props.onClickUp()
        }}
      >
        <box backgroundColor={buttonBg()} paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            ▲
          </text>
        </box>
      </box>
      <Show when={!isAtBottom()}>
        <box
          onMouseDown={(e) => {
            e.stopPropagation()
            props.onClickDown()
          }}
        >
          <box backgroundColor={buttonBg()} paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              ▼
            </text>
          </box>
        </box>
      </Show>
    </box>
  )
}
