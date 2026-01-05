import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"

interface DialogConfirmDeleteProps {
  title: string
  description?: string
  onConfirm: () => void | Promise<void>
}

export function DialogConfirmDelete(props: DialogConfirmDeleteProps) {
  const dialog = useDialog()

  async function handleConfirm() {
    await props.onConfirm()
    dialog.close()
  }

  return (
    <Dialog title={props.title}>
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        {props.description && <p class="text-14-regular text-text-base">{props.description}</p>}
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="large"
            class="bg-surface-critical-base hover:bg-surface-critical-base-hover"
            onClick={handleConfirm}
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
