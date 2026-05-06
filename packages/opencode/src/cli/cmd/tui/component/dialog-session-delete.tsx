import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { Locale } from "@/util/locale"

interface DialogSessionDeleteProps {
  session: string
}

export function DialogSessionDelete(props: DialogSessionDeleteProps) {
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()

  const session = createMemo(() => sync.session.get(props.session))

  const messageCount = createMemo(() => {
    return sync.data.message[props.session]?.length ?? 0
  })

  const childCount = createMemo(() => {
    return sync.data.session.filter((x) => x.parentID === props.session).length
  })

  const createdDate = createMemo(() => {
    const created = session()?.time.created
    if (!created) return "Unknown"
    return Locale.datetime(created)
  })

  const message = createMemo(() => {
    const title = session()?.title ?? "Untitled session"
    const messages = messageCount()
    const children = childCount()
    const created = createdDate()

    let text = `# ${title}\n\nAre you sure you want to delete this session?`

    text += `\n\nCreated: ${created}`
    text += `\nMessages: ${messages}`

    if (children > 0) {
      text += `\nChild sessions: ${children}`
    }

    text += "\n\nThis action cannot be undone."

    return text
  })

  return (
    <DialogConfirm
      title="Delete session"
      message={message()}
      onConfirm={() => {
        sdk.client.session.delete({
          sessionID: props.session,
        })
        route.navigate({ type: "home" })
      }}
    />
  )
}
