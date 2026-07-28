import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { Spinner } from "./spinner"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme } from "../context/theme"
import { visibleSessionTabs } from "../context/session-tabs-model"
import { Locale } from "../util/locale"

const TAB_WIDTH = 22

export function SessionTabs() {
  const tabs = useSessionTabs()
  const dimensions = useTerminalDimensions()
  const { themeV2, mode } = useTheme()
  const accent = () => themeV2.hue.accent[mode() === "light" ? 800 : 200]
  const tabWidth = createMemo(() => Math.max(8, Math.min(TAB_WIDTH, dimensions().width - 4)))
  const titleWidth = createMemo(() => tabWidth() - 5)
  const visible = createMemo(() =>
    visibleSessionTabs(
      tabs.tabs(),
      tabs.current(),
      Math.max(1, Math.floor((dimensions().width - 4) / (tabWidth() + 1))),
    ),
  )

  return (
    <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
      <For each={visible()}>
        {(tab) => {
          const selected = () => tabs.current() === tab.sessionID
          const unread = () => tabs.unread(tab.sessionID)
          return (
            <box
              width={tabWidth()}
              flexDirection="row"
              backgroundColor={selected() ? themeV2.raise(themeV2.background.surface.offset) : undefined}
              onMouseUp={() => tabs.select(tab.sessionID)}
            >
              <box width={2} alignItems="center">
                <Show
                  when={tabs.attention(tab.sessionID)}
                  fallback={<Show when={tabs.running(tab.sessionID)}>{<Spinner color={accent()} />}</Show>}
                >
                  <text fg={themeV2.text.feedback.warning.default}>!</text>
                </Show>
              </box>
              <text width={titleWidth()} fg={selected() ? themeV2.text.default : themeV2.text.subdued} wrapMode="none">
                {Locale.truncate(tab.title ?? "Untitled session", titleWidth())}
              </text>
              <text width={1} fg={unread() === "error" ? themeV2.text.feedback.error.default : accent()}>
                {unread() ? "•" : ""}
              </text>
              <text
                width={2}
                fg={themeV2.text.subdued}
                onMouseUp={(event) => {
                  event.stopPropagation()
                  tabs.close(tab.sessionID)
                }}
              >
                ×
              </text>
            </box>
          )
        }}
      </For>
      <Show when={tabs.tabs().length > visible().length}>
        <text fg={themeV2.text.subdued}>+{tabs.tabs().length - visible().length}</text>
      </Show>
    </box>
  )
}
