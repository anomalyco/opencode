import { useLanguage } from "../../context/language"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useData } from "../../context/data"
import { useRoute } from "../../context/route"
import { useClient } from "../../context/client"
import { Spinner } from "../../component/spinner"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { projectedPromptInput } from "../../prompt/codec"

export function DialogFork(props: { sessionID: string; messageID?: string; onMove?: (messageID?: string) => void }) {
  const language = useLanguage()
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const route = useRoute()
  const toast = useToast()
  const [pending, setPending] = createSignal(!!props.messageID)

  const fork = async (messageID?: string) => {
    setPending(true)
    const result = await client.api.session
      .fork({
        sessionID: props.sessionID,
        boundary: messageID ? { type: "before", messageID } : { type: "through" },
      })
      .catch((error) => {
        toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
        return undefined
      })
    if (!result) return dialog.clear()
    const message = messageID ? data.session.message.get(props.sessionID, messageID) : undefined
    const prompt = message?.type === "user" ? projectedPromptInput(message) : undefined
    route.navigate({
      sessionID: result.id,
      type: "session",
      prompt: prompt
        ? {
            ...prompt,
            agents: prompt.agents ?? [],
            pasted: [],
          }
        : undefined,
    })
    dialog.clear()
    toast.show({ message: language.t("tui.details.forkedSession"), variant: "success", duration: 4000 })
  }

  onMount(() => {
    dialog.setSize("large")
    if (props.messageID) void fork(props.messageID)
  })

  const options = createMemo((): DialogSelectOption<string | undefined>[] => [
    {
      title: language.t("tui.details.fullSession"),
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
        footer: language.date(message.time.created, { timeStyle: "short" }),
        onSelect: () => fork(message.id),
      })),
  ])

  return (
    <Show
      when={!pending()}
      fallback={
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <Spinner>{language.t("tui.details.forkingSession")}</Spinner>
        </box>
      }
    >
      <DialogSelect
        onMove={(option) => props.onMove?.(option.value)}
        title={language.t("tui.session.forkSession")}
        options={options()}
      />
    </Show>
  )
}
