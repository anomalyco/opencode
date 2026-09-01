import { createSignal, For, Show, type JSX } from "solid-js"
import { useTheme } from "../../context/theme"

export interface Tab {
  id: string
  label: string
  icon?: string
}

export function InkTabs(props: {
  tabs: Tab[]
  initialTab?: string
  onTabChange?: (id: string) => void
  children: (activeTab: string) => JSX.Element
  width?: number
}) {
  const { theme } = useTheme()
  const [active, setActive] = createSignal(props.initialTab ?? props.tabs[0]?.id ?? "")

  const switchTo = (id: string) => {
    setActive(id)
    props.onTabChange?.(id)
  }

  return (
    <box flexDirection="column" width={props.width ?? 38}>
      {/* Tab header bar */}
      <box
        flexDirection="row"
        borderColor={theme.border}
        border={["bottom"]}
        paddingBottom={0}
      >
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => tab.id === active()
            return (
              <box
                flexDirection="row"
                alignItems="center"
                paddingLeft={1}
                paddingRight={1}
                borderColor={isActive() ? theme.accent : "transparent"}
                border={isActive() ? ["bottom"] : []}
                onMouseDown={() => switchTo(tab.id)}
              >
                <text
                  fg={isActive() ? theme.accent : theme.textMuted}
                >
                  {tab.icon ? `${tab.icon} ` : ""}
                  <Show when={isActive()} fallback={tab.label}>
                    <b>{tab.label}</b>
                  </Show>
                </text>
              </box>
            )
          }}
        </For>
      </box>

      {/* Tab content */}
      <box flexGrow={1} paddingTop={1}>
        {props.children(active())}
      </box>
    </box>
  )
}
