import { createMemo } from "solid-js"
import { useSync } from "../../context/sync"
import { DialogSelect } from "../../ui/dialog-select"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useClipboard } from "../../context/clipboard"
import type { PromptInfo } from "../../component/prompt/history"
import { useToast } from "../../ui/toast"
import { TuiConfig, useTuiConfig } from "../../config"
import type { DialogContext } from "../../ui/dialog"
import { messagePrompt, revertChoices, revertSession } from "./revert"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()
  const clipboard = useClipboard()
  const toast = useToast()
  const tuiConfig = useTuiConfig()

  const revertOptions = revertChoices(TuiConfig.revertFiles(tuiConfig.revert)).map((choice) => ({
    title: choice.title,
    value: choice.value,
    description: choice.description,
    onSelect: (dialog: DialogContext) => {
      const msg = message()
      if (!msg) return
      const draft = messagePrompt(sync.data.part[msg.id] ?? [])
      const busy = (sync.data.session_status?.[props.sessionID]?.type ?? "idle") !== "idle"
      const done = revertSession({ sync, sdk, toast, sessionID: props.sessionID, messageID: msg.id, files: choice.files })
      // A running turn makes the server refuse the revert, so the prompt only comes back once it went through.
      if (busy) void done.then((reverted) => reverted && props.setPrompt?.(draft))
      if (!busy) props.setPrompt?.(draft)
      dialog.clear()
    },
  }))

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        ...revertOptions,
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

            await clipboard.write?.(text)
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
            const msg = message()
            const prompt = msg
              ? sync.data.part[msg.id].reduce(
                  (agg, part) => {
                    if (part.type === "text") {
                      if (!part.synthetic) agg.input += part.text
                    }
                    if (part.type === "file") agg.parts.push(part)
                    return agg
                  },
                  { input: "", parts: [] as PromptInfo["parts"] },
                )
              : undefined
            route.navigate({
              sessionID: result.data!.id,
              type: "session",
              prompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
