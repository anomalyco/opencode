import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import type { PromptInfo } from "@tui/component/prompt/history"
import type { Session as SessionType } from "@opencode-ai/sdk"
import { useToast } from "../../ui/toast"
import { Locale } from "@/util/locale"
import { estimateMessageTokens, pickMessageContentParts } from "@/session/message-content"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
  onRevert?: (info: SessionType["revert"] | undefined) => void
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
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            const confirmed = await DialogConfirm.show(
              dialog,
              "Confirm Revert",
              "Rewind to this point and drop newer messages?",
            )
            if (!confirmed) return

            try {
              const response = await sdk.client.session.revert({
                path: {
                  id: props.sessionID,
                },
                body: {
                  messageID: msg.id,
                },
              })

              if (response.data) {
                const index = sync.data.session.findIndex((session) => session.id === props.sessionID)
                if (index !== -1) {
                  sync.set("session", index, response.data)
                }
                props.onRevert?.(response.data.revert ?? { messageID: msg.id })
                await sync.session.sync(props.sessionID, { force: true })
                props.onRevert?.(undefined)
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : "Failed to revert message"
              toast.show({ message, variant: "error" })
              dialog.clear()
              return
            }

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
