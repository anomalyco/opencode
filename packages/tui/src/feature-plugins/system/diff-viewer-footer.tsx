import type { Plugin } from "@opencode-ai/plugin/tui"
import type { PanelInput } from "@opencode-ai/plugin/tui/context"
import { MouseButton } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { stringWidth } from "../../util/string-width"

export function DiffViewerFooter(props: { context: Plugin.Context; panel: PanelInput; onHelp: () => void }) {
  const theme = useTheme()
  const key = (...ids: string[]) =>
    ids
      .map((id) => props.context.keymap.shortcuts(id)[0])
      .filter(Boolean)
      .join("/")
  const focus = () => key("pane.focus.right")
  const help = () => key("diff.help")
  const hints = createMemo(() => {
    const available = props.panel.width - 4 - stringWidth(`${help()} see all`) - 2
    return [
      { key: key("pane.focus.left"), label: "focus session" },
      { key: key("diff.toggle_fullscreen"), label: "full screen" },
      { key: key("diff.down", "diff.up"), label: "scroll" },
      { key: key("diff.next_file", "diff.previous_file"), label: "files" },
      { key: key("diff.next_hunk", "diff.previous_hunk"), label: "hunks" },
      { key: key("diff.close"), label: "close" },
    ]
      .filter((hint) => hint.key)
      .reduce<{ width: number; items: { key: string; label: string }[] }>(
        (result, hint) => {
          const width = result.width + (result.items.length ? 2 : 0) + stringWidth(`${hint.key} ${hint.label}`)
          return width <= available ? { width, items: [...result.items, hint] } : result
        },
        { width: 0, items: [] },
      ).items
  })

  return (
    <box id="diff-footer" height={3} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexShrink={0}>
      <Show
        when={props.panel.focused}
        fallback={
          <text
            fg={theme.text.subdued}
            wrapMode="none"
            truncate
            onMouseUp={(event) => {
              if (event.button === MouseButton.LEFT) props.panel.focus()
            }}
          >
            <span style={{ fg: theme.text.default }}>{focus() || "click"}</span>
            {" focus diff"}
          </text>
        }
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.text.subdued} flexGrow={1} minWidth={0} wrapMode="none" truncate>
            <For each={hints()}>
              {(hint, index) => (
                <>
                  {index() ? "  " : ""}
                  <span style={{ fg: theme.text.default }}>{hint.key}</span>
                  {` ${hint.label}`}
                </>
              )}
            </For>
          </text>
          <text
            fg={theme.text.subdued}
            flexShrink={0}
            wrapMode="none"
            onMouseUp={(event) => {
              if (event.button === MouseButton.LEFT) props.onHelp()
            }}
          >
            <span style={{ fg: theme.text.default }}>{help()}</span>
            {help() ? " see all" : "see all"}
          </text>
        </box>
      </Show>
    </box>
  )
}
