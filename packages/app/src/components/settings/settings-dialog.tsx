import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SshKeysDialog } from "./ssh-keys-dialog"

export function SettingsDialog() {
  const dialog = useDialog()

  return (
    <Dialog title="Settings" description="Manage your OpenCode settings." class="max-w-[720px]">
      <div class="flex flex-col gap-4 px-2 pb-3">
        <SshKeysDialog />
        <div class="flex justify-end gap-2 pt-2">
          <Button size="large" variant="ghost" onClick={() => dialog.close()}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
