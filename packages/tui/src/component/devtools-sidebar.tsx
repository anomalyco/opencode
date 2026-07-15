import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "../context/theme"
import { DevTools } from "../devtools"

export function DevToolsSidebar() {
  const { themeV2 } = useTheme().contextual("elevated")

  return (
    <box
      width={42}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={themeV2.background()}
    >
      <For each={DevTools.data()}>
        {(group) => (
          <box flexShrink={0} marginBottom={1}>
            <box marginBottom={1}>
              <text fg={themeV2.background.action.primary()} attributes={TextAttributes.BOLD}>
                {group.title}
              </text>
            </box>
            <For each={group.entries}>
              {(entry) => (
                <box flexDirection="row">
                  <text fg={themeV2.text.subdued()}>{entry.key}</text>
                  <box flexGrow={1} />
                  <text fg={themeV2.text()}>{String(entry.value)}</text>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
