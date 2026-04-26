import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { createPromptInfoFromParts } from "./prompt-info"

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID?: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string | undefined>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const fullSession = {
      title: "Full session",
      value: undefined,
      onSelect: async (dialog: DialogContext) => {
        const forked = await sdk.client.session.fork({ sessionID: props.sessionID })
        route.navigate({
          sessionID: forked.data!.id,
          type: "session",
        })
        dialog.clear()
      },
    } satisfies DialogSelectOption<string | undefined>
    const result = [] as DialogSelectOption<string | undefined>[]
    for (const message of messages) {
      if (message.role !== "user") continue
      const prompt = createPromptInfoFromParts(sync.data.part[message.id] ?? [])
      if (!prompt.input) continue
      result.push({
        title: prompt.input.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: async (dialog) => {
          const forked = await sdk.client.session.fork({
            sessionID: props.sessionID,
            messageID: message.id,
          })
          route.navigate({
            sessionID: forked.data!.id,
            type: "session",
            prompt,
          })
          dialog.clear()
        },
      })
    }
    return [fullSession, ...result.reverse()]
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Fork session" options={options()} />
}
