import { onMount } from "solid-js"
import { useData } from "../../context/data"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { Locale } from "../../util/locale"
import { useDialog } from "../../ui/dialog"
import type { SessionMessageInfo } from "@opencode/client"

/** The searchable text content of a session message, across all message types. */
export function messageText(message: SessionMessageInfo): string {
  switch (message.type) {
    case "user":
      return message.text
    case "assistant":
      return message.content
        .filter((part) => part.type === "text" || part.type === "reasoning")
        .map((part) => part.text)
        .join("\n")
    case "shell":
      return [message.command, message.output?.output].filter(Boolean).join("\n")
    case "system":
    case "synthetic":
      return message.text
    case "skill":
      return message.text
    case "compaction":
      return message.status === "failed" ? "" : (message.summary ?? "")
    default:
      return ""
  }
}

export function DialogSearch(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const data = useData()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const search = (query: string): DialogSelectOption<string>[] => {
    const needle = query.toLowerCase()
    return data.session.message
      .list(props.sessionID)
      .flatMap((message) => {
        const text = messageText(message)
        if (!text) return []
        if (!needle || text.toLowerCase().includes(needle)) {
          return [
            {
              title: text.replace(/\n/g, " ").trim(),
              value: message.id,
              description: message.type,
              footer: Locale.time(message.time.created),
            },
          ]
        }
        return []
      })
      .toReversed()
  }

  return (
    <DialogSelect
      options={[]}
      search={search}
      searchInTitle
      title="Search session"
      titlePlaceholder="Search session"
      onSelect={(option) => {
        props.onMove(option.value)
        dialog.clear()
      }}
    />
  )
}
