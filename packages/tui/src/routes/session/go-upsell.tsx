import { onCleanup, type Accessor } from "solid-js"
import open from "open"
import { useData } from "../../context/data"
import { useStorage } from "../../context/storage"
import { useDialog } from "../../ui/dialog"
import { DialogGo } from "../../component/dialog-go"
import { useToast } from "../../ui/toast"

export function useGoUpsell(sessionID: Accessor<string>) {
  const data = useData()
  const dialog = useDialog()
  const toast = useToast()
  const [state, update] = useStorage().store("go-upsell", {
    initial: { lastSeenAt: 0, dontShowAgain: false },
  })

  onCleanup(
    data.on("session.execution.failed", (event) => {
      if (event.data.sessionID !== sessionID()) return
      if (event.data.error.type !== "provider.free-tier-limit") return
      if (dialog.stack.length > 0 || state.dontShowAgain) return
      if (state.lastSeenAt && Date.now() - state.lastSeenAt < 86_400_000) return

      let dontShowAgain = false
      dialog.replace(
        () => (
          <DialogGo
            onSubscribe={() => void open("https://opencode.ai/go").catch(toast.error)}
            onDismiss={() => {
              dontShowAgain = true
            }}
          />
        ),
        () => {
          void update((draft) => {
            draft.lastSeenAt = Date.now()
            if (dontShowAgain) draft.dontShowAgain = true
          }).catch(toast.error)
        },
      )
    }),
  )
}
