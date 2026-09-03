import { onCleanup, type Accessor } from "solid-js"
import open from "open"
import { useData } from "../../context/data"
import { useStorage } from "../../context/storage"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
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
          <DialogConfirm
            title="Free limit reached"
            message={
              "Subscribe to OpenCode Go for reliable access to the best open-source models, starting at $5/month.\n\nhttps://opencode.ai/go"
            }
            label={{ confirm: "Subscribe", cancel: "Don't show again" }}
            onConfirm={() => void open("https://opencode.ai/go").catch(toast.error)}
            onCancel={() => {
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
