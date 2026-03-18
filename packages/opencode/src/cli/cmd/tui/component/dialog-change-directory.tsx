import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"

export function DialogChangeDirectory() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()

  return (
    <DialogPrompt
      title="Change Directory"
      value={sync.data.path.directory || sdk.directory || "/"}
      placeholder="/path/to/project"
      onConfirm={(value) => {
        const dir = value.trim().replace(/\/+$/g, "") || "/"
        dialog.clear()
        sdk.setDirectory(dir)
        route.navigate({ type: "home" })
        void sync.bootstrap()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
