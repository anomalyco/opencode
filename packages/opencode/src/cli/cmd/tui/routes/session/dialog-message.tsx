import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import type { PromptInfo } from "@tui/component/prompt/history"
import { useToast } from "../../ui/toast"
import { Locale } from "@/util/locale"
import { estimateMessageTokens, pickMessageContentParts } from "@/session/message-content"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()
  const toast = useToast()
  const parts = createMemo(() => sync.data.part[props.messageID] ?? [])
  const compactTokens = createMemo(() => {
    const content = pickMessageContentParts(parts())
    return estimateMessageTokens(content)
  })

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: `Compact message (${Locale.number(compactTokens() || 0)} tokens)`,
          value: "session.compactMessage",
          description: "Summarize this message to reduce context usage",
          onSelect: (dialog) => {
            dialog.clear()
            sdk.client.session
              .compactMessage({
                path: {
                  id: props.sessionID,
                  messageID: props.messageID,
                },
              })
              .then(() => {
                toast.show({ message: "Message compacted", variant: "success" })
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : "Failed to compact message"
                toast.show({ message, variant: "error" })
              })
          },
        },
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) return

            sdk.client.session.revert({
              path: {
                id: props.sessionID,
              },
              body: {
                messageID: msg.id,
              },
            })

            if (props.setPrompt) {
              const parts = sync.data.part[msg.id]
              const promptInfo = parts.reduce(
                (agg, part) => {
                  if (part.type === "text") {
                    if (!part.synthetic) agg.input += part.text
                  }
                  if (part.type === "file") agg.parts.push(part)
                  return agg
                },
                { input: "", parts: [] as PromptInfo["parts"] },
              )
              props.setPrompt(promptInfo)
            }

            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: async (dialog) => {
            const result = await sdk.client.session.fork({
              path: {
                id: props.sessionID,
              },
              body: {
                messageID: props.messageID,
              },
            })
            route.navigate({
              sessionID: result.data!.id,
              type: "session",
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
