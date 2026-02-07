import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import type { PromptInfo } from "@tui/component/prompt/history"

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const toast = useToast()

  const forkCurrentValue = "__fork_current__"

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
          dialog.clear()
          const forked = await sdk.client.session
            .fork({
              sessionID: props.sessionID,
              messageID: message.id,
            })
            .catch(() => {
              toast.show({ message: "Failed to fork session", variant: "error" })
            })
          if (!forked?.data?.id) return
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
          toast.show({ message: `Created new session: ${forked.data.title}`, variant: "success" })
          route.navigate({
            sessionID: forked.data.id,
            type: "session",
            initialPrompt,
          })
        },
      })
    }

    // Quick option to fork the current session state (no message selection).
    result.push({
      title: "Fork current session",
      value: forkCurrentValue,
      footer: "Current",
      onSelect: async (dialog) => {
        dialog.clear()
        const forked = await sdk.client.session
          .fork({
            sessionID: props.sessionID,
          })
          .catch(() => {
            toast.show({ message: "Failed to fork session", variant: "error" })
          })
        if (!forked?.data?.id) return
        toast.show({ message: `Created new session: ${forked.data.title}`, variant: "success" })
        route.navigate({
          sessionID: forked.data.id,
          type: "session",
        })
      },
    })

    result.reverse()
    return result
  })

  const move = (value: string) => {
    if (value !== forkCurrentValue) {
      props.onMove(value)
      return
    }

    const latest = (sync.data.message[props.sessionID] ?? []).findLast((x) => x.role === "user")?.id
    if (!latest) return
    props.onMove(latest)
  }

  return <DialogSelect onMove={(option) => move(option.value)} title="Fork from message" options={options()} />
}
