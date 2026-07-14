import { createMemo, createSignal, onMount, Show } from "solid-js"
import { unwrap } from "solid-js/store"
import { useData } from "../../context/data"
import { useRoute } from "../../context/route"
import { useClient } from "../../context/client"
import { Spinner } from "../../component/spinner"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"

export function DialogFork(props: { sessionID: string; messageID?: string; onMove?: (messageID?: string) => void }) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const route = useRoute()
  const toast = useToast()
  const [pending, setPending] = createSignal(false)

  const fork = async (messageID?: string) => {
    setPending(true)
    const result = await client.api.session.fork({ sessionID: props.sessionID, messageID }).catch((error) => {
      toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
      return undefined
    })
    if (!result) return dialog.clear()
    const message = messageID ? data.session.message.get(props.sessionID, messageID) : undefined
    route.navigate({
      sessionID: result.id,
      type: "session",
      prompt:
        message?.type === "user"
          ? {
              text: message.text,
              files: message.files?.map((file) => ({
                uri: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
                name: file.name,
                description: file.description,
                mention: file.mention,
              })),
              agents: structuredClone(unwrap(message.agents ?? [])),
              pasted: [],
            }
          : undefined,
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
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <Spinner>Forking session...</Spinner>
        </box>
      }
    >
      <DialogSelect
        onMove={(option) => props.onMove?.(option.value)}
        title="Fork session"
        options={options()}
      />
    </Show>
  )
}
