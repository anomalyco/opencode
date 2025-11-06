import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"

export function DialogMessage(props: { messageID: string; sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() =>
    sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID),
  )
  const route = useRoute()

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            sdk.client.session.revert({
              path: {
                id: props.sessionID,
              },
              body: {
                messageID: message()!.id,
              },
            })
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
