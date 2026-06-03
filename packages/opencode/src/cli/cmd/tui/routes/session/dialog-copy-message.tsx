import { createMemo, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Locale } from "@/util/locale"
import { useDialog } from "../../ui/dialog"
import * as Clipboard from "@tui/util/clipboard"
import { useToast } from "../../ui/toast"

export function DialogCopyMessage(props: {
  sessionID: string
  revertID?: string
}) {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const result = [] as DialogSelectOption<string>[]
    for (const message of messages) {
      if (message.role !== "assistant") continue
      if (props.revertID && message.id >= props.revertID) continue

      const parts = sync.data.part[message.id] ?? []
      const textParts = parts.filter((p) => p.type === "text")
      if (textParts.length === 0) continue

      const text = textParts.map((p) => p.text).join("\n").trim()
      if (!text) continue

      const preview = text.split("\n")[0].slice(0, 80)
      result.push({
        title: preview.length < text.split("\n")[0].length ? preview + "…" : preview,
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: async () => {
          try {
            await Clipboard.copy(text)
            toast.show({ message: "Message copied to clipboard!", variant: "success" })
          } catch {
            toast.show({ message: "Failed to copy to clipboard", variant: "error" })
          }
          dialog.clear()
        },
      })
    }
    result.reverse()
    return result
  })

  return (
    <Show
      when={options().length > 0}
      fallback={
        <>
          {toast.show({ message: "No assistant messages found", variant: "error" })}
          {dialog.clear()}
        </>
      }
    >
      <DialogSelect title="Copy Message" options={options()} />
    </Show>
  )
}
