import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useData } from "../../context/data"
import { useRoute } from "../../context/route"
import { useClient } from "../../context/client"
import { Spinner } from "../../component/spinner"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { DIALOG_LIST_INSET, DialogHeader, DialogLayout, useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"
import { usePromptRestore } from "../../prompt/restore"

export function DialogFork(props: { sessionID: string; messageID?: string; onMove?: (messageID?: string) => void }) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const route = useRoute()
  const toast = useToast()
  const restorePrompt = usePromptRestore()
  const [pending, setPending] = createSignal(!!props.messageID)

  const fork = async (messageID?: string) => {
    setPending(true)
    const message = messageID ? data.session.message.get(props.sessionID, messageID) : undefined
    const prompt =
      message?.type === "user"
        ? await restorePrompt(message, { allowMissing: false }).catch((error) => {
            toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
            return null
          })
        : undefined
    if (prompt === null) return dialog.clear()
    const result = await client.api.session
      .fork({
        sessionID: props.sessionID,
        before: messageID,
      })
      .catch((error) => {
        toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
        return undefined
      })
    if (!result) return dialog.clear()
    route.navigate({
      sessionID: result.id,
      type: "session",
      prompt: prompt && { ...prompt, agents: prompt.agents ?? [] },
    })
    dialog.clear()
    toast.show({ message: "Forked session", variant: "success", duration: 4000 })
  }

  onMount(() => {
    dialog.setSize("large")
    if (props.messageID) void fork(props.messageID)
  })

  const options = createMemo((): DialogSelectOption<string | undefined>[] => [
    {
      title: "Full session",
      value: undefined,
      onSelect: () => fork(),
    },
    ...data.session.message
      .list(props.sessionID)
      .filter((message) => message.type === "user")
      .toReversed()
      .map((message) => ({
        title: message.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: () => fork(message.id),
      })),
  ])

  return (
    <Show
      when={!pending()}
      fallback={
        <DialogLayout inset={DIALOG_LIST_INSET} header={<DialogHeader title="Fork session" />}>
          <Spinner>Forking session…</Spinner>
        </DialogLayout>
      }
    >
      <DialogSelect onMove={(option) => props.onMove?.(option.value)} title="Fork session" options={options()} />
    </Show>
  )
}
