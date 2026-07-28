import { For, Show, createMemo, createSignal } from "solid-js"
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
  const [hovered, setHovered] = createSignal<string>()
  const accent = () => themeV2.hue.accent[mode() === "light" ? 800 : 200]
  const tabWidth = createMemo(() => Math.max(8, Math.min(TAB_WIDTH, dimensions().width - 4)))
  const titleWidth = createMemo(() => Math.max(1, tabWidth() - 7))
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
          const background = () => {
            if (selected()) return themeV2.raise(themeV2.background.surface.offset)
            if (hovered() === tab.sessionID) return themeV2.background.action.primary.hovered
          }
          const foreground = () => {
            if (selected()) return themeV2.text.default
            if (hovered() === tab.sessionID) return themeV2.text.default
            return themeV2.text.subdued
          }
          const numberColor = () => {
            if (unread() === "error") return themeV2.text.feedback.error.default
            if (unread() === "activity") return accent()
            if (selected()) return accent()
            return foreground()
          }
          return (
            <box
              width={tabWidth()}
              flexDirection="row"
              backgroundColor={background()}
              onMouseOver={() => setHovered(tab.sessionID)}
              onMouseOut={() => setHovered(undefined)}
              onMouseUp={() => tabs.select(tab.sessionID)}
            >
              <text
                width={1}
                fg={selected() ? accent() : hovered() === tab.sessionID ? themeV2.text.default : themeV2.text.subdued}
              >
                ▏
              </text>
              <box width={2} alignItems="center">
                <Show
                  when={tabs.attention(tab.sessionID)}
                  fallback={
                    <Show
                      when={unread()}
                      fallback={<Show when={tabs.running(tab.sessionID)}>{<Spinner color={accent()} />}</Show>}
                    >
                      <text fg={unread() === "error" ? themeV2.text.feedback.error.default : accent()}>•</text>
                    </Show>
                  }
                >
                  <text fg={themeV2.text.feedback.warning.default}>!</text>
                </Show>
              </box>
              <text width={2} fg={numberColor()}>
                {tabs.tabs().findIndex((item) => item.sessionID === tab.sessionID) + 1}
              </text>
              <text width={titleWidth()} fg={foreground()} wrapMode="none">
                {Locale.truncate(tab.title ?? "Untitled session", titleWidth())}
              </text>
              <text
                width={2}
                fg={foreground()}
                onMouseUp={(event) => {
                  event.stopPropagation()
                  tabs.close(tab.sessionID)
                }}
              >
                {hovered() === tab.sessionID ? "×" : ""}
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
