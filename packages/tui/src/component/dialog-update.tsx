/** @jsxImportSource @opentui/solid */
import { DialogConfirm } from "../ui/dialog-confirm"

export function DialogUpdate(props: { onInstall: () => void }) {
  return (
    <DialogConfirm
      title="Update ready"
      message="An update is ready. Active sessions will be restarted."
      label={{ confirm: "Install", cancel: "Ignore" }}
      onConfirm={props.onInstall}
    />
  )
}
