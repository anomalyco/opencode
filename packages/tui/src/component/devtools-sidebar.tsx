import { TextAttributes } from "@opentui/core"
import { createSignal, For } from "solid-js"
import { useTheme } from "../context/theme"
import { DevTools } from "../devtools"

export function DevToolsSidebar() {
  const { themeV2, mode, setMode } = useTheme().contextual("elevated")
  const [modeHovered, setModeHovered] = createSignal(false)

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
      <box flexShrink={0} marginBottom={1}>
        <box marginBottom={1}>
          <text fg={themeV2.text.action()} attributes={TextAttributes.BOLD}>
            Theme
          </text>
        </box>
        <box flexDirection="row">
          <text fg={themeV2.text.subdued()}>Mode</text>
          <box flexGrow={1} />
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={modeHovered() ? themeV2.background.action("hovered") : undefined}
            onMouseOver={() => setModeHovered(true)}
            onMouseOut={() => setModeHovered(false)}
            onMouseUp={() => setMode(mode() === "dark" ? "light" : "dark")}
          >
            <text fg={themeV2.text()}>{mode()}</text>
          </box>
        </box>
      </box>
      <For each={DevTools.data()}>
        {(group) => (
          <box flexShrink={0} marginBottom={1}>
            <box marginBottom={1}>
              <text fg={themeV2.text.action()} attributes={TextAttributes.BOLD}>
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
