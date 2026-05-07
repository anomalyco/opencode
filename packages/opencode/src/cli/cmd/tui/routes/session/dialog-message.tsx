import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { Clipboard } from "@tui/util/clipboard"
import { promptInfoFromMessageParts, type PromptInfo } from "@tui/component/prompt/history"
import { useToast } from "@tui/ui/toast"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()
  const busy = createMemo(() => {
    const status = sync.data.session_status?.[props.sessionID]
    if (status?.type !== "idle") return true
    return (sync.data.message[props.sessionID] ?? []).some(
      (item) => item.role === "assistant" && typeof item.time.completed !== "number",
    )
  })
  const historyMutationBlocked = createMemo(() => {
    if (!sync.session.pendingKnown(props.sessionID)) return true
    const pending = sync.session.pending(props.sessionID)
    return !!pending.stopRequested || pending.steer.length > 0 || pending.queue.length > 0
  })
  const prepareHistoryMutation = async () => {
    if (!busy()) return
    await sdk.client.session.stop({ sessionID: props.sessionID })
    const pending = await sdk.client.session.pending({ sessionID: props.sessionID })
    if (
      pending.data?.paused &&
      pending.data.steer.length === 0 &&
      pending.data.queue.length === 0
    ) {
      await sdk.client.session.pendingResume({ sessionID: props.sessionID })
    }
  }

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          disabled: historyMutationBlocked(),
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            try {
              await prepareHistoryMutation()
              const result = await sdk.client.session.revert({
                sessionID: props.sessionID,
                messageID: msg.id,
              })
              if (result.error) throw result.error

              if (props.setPrompt) {
                props.setPrompt(promptInfoFromMessageParts(sync.data.part[msg.id]))
              }

              dialog.clear()
            } catch (error) {
              toast.show({
                message: error instanceof Error ? error.message : "Failed to revert message",
                variant: "error",
              })
            }
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            const parts = sync.data.part[msg.id]
            const text = parts.reduce((agg, part) => {
              if (part.type === "text" && !part.synthetic) {
                agg += part.text
              }
              return agg
            }, "")

            await Clipboard.copy(text)
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: async (dialog) => {
            const result = await sdk.client.session.fork({
              sessionID: props.sessionID,
              messageID: props.messageID,
            })
            const initialPrompt = (() => {
              const msg = message()
              if (!msg) return undefined
              return promptInfoFromMessageParts(sync.data.part[msg.id])
            })()
            route.navigate({
              sessionID: result.data!.id,
              type: "session",
              initialPrompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
