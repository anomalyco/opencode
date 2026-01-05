import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"
import { showToast } from "@opencode-ai/ui/toast"
import type { Session } from "@opencode-ai/sdk/v2/client"

interface DialogSessionRenameProps {
  session: Session
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const [title, setTitle] = createSignal(props.session.title)
  const [saving, setSaving] = createSignal(false)

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const newTitle = title().trim()
    if (!newTitle || newTitle === props.session.title) {
      dialog.close()
      return
    }

    setSaving(true)
    try {
      await sdk.client.session.update({
        sessionID: props.session.id,
        title: newTitle,
      })
      showToast({ title: "Session renamed" })
      dialog.close()
    } catch (err) {
      console.error("Failed to rename session", err)
      showToast({ title: "Failed to rename session", description: String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Rename session">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 px-2.5 pb-3">
        <TextField
          autofocus
          type="text"
          label="Title"
          placeholder="Enter session title"
          value={title()}
          onChange={setTitle}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={saving()}>
            {saving() ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
