import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { createMemo } from "solid-js"
import { Locale } from "../util/locale"
import { type PromptInfo } from "../prompt/history"

function getHistoryPreview(input: string, maxLength: number = 60): string {
  const firstLine = input.split("\n").find((line) => line.trim().length > 0) ?? ""
  return Locale.truncate(firstLine.trim(), maxLength)
}

export function DialogPromptHistory(props: { entries: PromptInfo[]; onSelect: (entry: PromptInfo) => void }) {
  const dialog = useDialog()

  const options = createMemo(() => {
    return props.entries
      .map((entry, index) => {
        const preview = getHistoryPreview(entry.input)
        const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1
        return {
          title: preview,
          value: index,
          footer: lineCount > 1 ? `~${lineCount} lines` : undefined,
        }
      })
      .filter((option) => option.title.length > 0)
      .toReversed()
  })

  return (
    <DialogSelect
      title="History"
      placeholder="Search prompt history"
      options={options()}
      onSelect={(option) => {
        const entry = props.entries[option.value]
        if (entry) props.onSelect(entry)
        dialog.clear()
      }}
    />
  )
}
