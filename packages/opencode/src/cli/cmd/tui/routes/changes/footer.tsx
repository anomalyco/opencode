import { createMemo, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"

export function Footer(props: { mode: "list" | "diff"; hasComments: boolean }) {
  const theme = useTheme()
  const label = createMemo(() => (props.mode === "list" ? "Files" : "Diff"))
  const accent = createMemo(() => (props.mode === "list" ? theme.theme.primary : theme.theme.diffHighlightAdded))

  return (
    <box
      border={["left"]}
      borderColor={accent()}
      customBorderChars={{
        ...EmptyBorder,
        vertical: "┃",
      }}
      width="100%"
      flexShrink={0}
      margin={0}
      padding={0}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        width="100%"
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="row" gap={2} alignItems="center">
          <text fg={accent()}>{label()}</text>
          <text fg={theme.theme.text}>
            tab <span style={{ fg: theme.theme.textMuted }}>switch</span>
          </text>
          <text fg={theme.theme.text}>
            esc <span style={{ fg: theme.theme.textMuted }}>cancel</span>
          </text>
        </box>
        <Show when={props.mode === "diff" && props.hasComments}>
          <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
            <text fg={theme.theme.text}>
              ctrl+enter <span style={{ fg: theme.theme.textMuted }}>submit</span>
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}
