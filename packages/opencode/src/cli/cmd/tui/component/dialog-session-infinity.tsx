import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"

export function DialogSessionInfinity(props: {
  sessionID?: string
  onConfirm?: () => void
}) {
  const dialog = useDialog()
  const sdk = useSDK()

  return (
    <DialogConfirm
      title="Infinity Mode"
      label="Enable"
      message="Enable autonomous continuation? The AI will re-prompt itself until your original goal is completed."
      onConfirm={() => {
        if (props.sessionID) {
          sdk.client.session.infinitySet({ sessionID: props.sessionID })
        }
        props.onConfirm?.()
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
