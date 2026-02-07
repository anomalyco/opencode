import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useTab } from "@tui/context/tab"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { tabTitle, tabStatus, tabStatusIndicator, STATUS_LABEL, type TabStatus } from "./tab-bar"

function gutter(s: TabStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  const ind = tabStatusIndicator(s, theme)
  if (!ind) return undefined
  return <text fg={ind.color}>{ind.symbol}</text>
}

export function DialogTabList() {
  const dialog = useDialog()
  const tab = useTab()
  const sync = useSync()
  const { theme } = useTheme()
  const keybind = useKeybind()

  const options = createMemo(() =>
    tab.tabs.map((t, idx) => {
      const title = tabTitle(t.route, sync)
      const s = tabStatus(t.route, sync)
      const label = STATUS_LABEL[s]
      return {
        title: `${idx + 1}: ${title}`,
        value: t.id,
        description: s !== "idle" ? label : undefined,
        gutter: gutter(s, theme),
      }
    }),
  )

  return (
    <DialogSelect
      title="Tabs"
      options={options()}
      current={tab.active.id}
      onSelect={(option) => {
        tab.select(option.value)
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.tab_close?.[0],
          title: "close",
          onTrigger: (option) => {
            tab.close(option.value)
          },
        },
      ]}
    />
  )
}
