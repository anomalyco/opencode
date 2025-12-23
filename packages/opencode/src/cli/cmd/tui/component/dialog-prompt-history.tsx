import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import { createMemo, createSignal, onMount } from "solid-js"
import { usePromptHistory, type PromptInfo } from "./prompt/history"

function formatPrompt(info: PromptInfo, maxLength?: number): string {
  const parts = info.parts
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "file") return `@${part.filename || "file"}`
      if (part.type === "agent") return `/${part.name}`
      return ""
    })
    .filter(Boolean)
    .join(" ")

  const text = (parts || info.input).trim().replace(/\n+/g, " ")
  if (maxLength && text.length > maxLength) {
    return text.slice(0, maxLength) + "…"
  }
  return text
}

type HistoryOption = DialogSelectOption<number> & {
  historyInfo: PromptInfo
}

const TITLE_CHAR_LIMIT = 61
const DESCRIPTION_CHAR_LIMIT = 200

export function DialogPromptHistory(props: { onSelect: (info: PromptInfo) => void }) {
  const dialog = useDialog()
  const history = usePromptHistory()
  const [activeValue, setActiveValue] = createSignal<number>(0)
  let selectRef: DialogSelectRef<number> | undefined

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    const weekAgo = Date.now() - 7 * 86400000
    const currentActiveValue = activeValue()

    // Reverse history to show most recent first
    return [...history.history].reverse().map((info, index) => {
      const timestamp = Date.now() - index * 60000 // Approximate timestamp
      const date = new Date(timestamp)
      const dateStr = date.toDateString()

      let category: string
      if (dateStr === today) {
        category = "Today"
      } else if (dateStr === yesterday) {
        category = "Yesterday"
      } else if (timestamp > weekAgo) {
        category = "This Week"
      } else {
        category = "Older"
      }

      const fullPromptText = formatPrompt(info)
      const modeIndicator = info.mode === "shell" ? "$ " : ""
      const isActive = currentActiveValue === index

      const title = modeIndicator + fullPromptText

      // For active item with long text, set description to trigger full display (no truncation)
      // The description content doesn't matter since title won't be truncated when description exists
      const needsExpansion = isActive && fullPromptText.length > TITLE_CHAR_LIMIT
      const description = needsExpansion ? " " : undefined

      return {
        value: index,
        title,
        description,
        category,
        footer: info.mode === "shell" ? "shell" : undefined,
        historyInfo: info,
      } as HistoryOption
    })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Prompt History"
      options={options()}
      ref={(r) => (selectRef = r)}
      onMove={(option) => {
        setActiveValue(option.value as number)
      }}
      onFilter={() => {
        // When filter changes, first filtered item becomes active
        // Get the first filtered item's value
        const firstFiltered = selectRef?.filtered[0]
        if (firstFiltered) {
          setActiveValue(firstFiltered.value)
        }
      }}
      onSelect={(option) => {
        props.onSelect((option as HistoryOption).historyInfo)
        dialog.clear()
      }}
    />
  )
}
