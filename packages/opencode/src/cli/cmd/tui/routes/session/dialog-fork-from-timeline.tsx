import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const result = [] as DialogSelectOption<string>[]
    for (const message of messages) {
      if (message.role !== "user") continue
      const part = (sync.data.part[message.id] ?? []).find(
        (x) => x.type === "text" && !x.synthetic && !x.ignored,
      ) as TextPart
      if (!part) continue
      result.push({
        title: part.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: async (dialog) => {
          const forked = await sdk.client.session.fork({
            sessionID: props.sessionID,
            messageID: message.id,
          })
          const parts = sync.data.part[message.id] ?? []
          const initialPrompt = parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          )
          route.navigate({
            sessionID: forked.data!.id,
            type: "session",
            initialPrompt,
          })
          dialog.clear()
        },
      })
    }
    result.reverse()
    return result
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Fork from message" options={options()} />
}
