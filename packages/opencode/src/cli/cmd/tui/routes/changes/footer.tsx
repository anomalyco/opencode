import { createMemo, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"

export function Footer(props: { mode: "list" | "diff" }) {
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
      paddingLeft={0}
      marginLeft={0}
      flexShrink={0}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        width="100%"
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
        <Show when={props.mode === "diff"}>
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
