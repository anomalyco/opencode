import { Component, createSignal, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"

export const DialogSshPassword: Component<{
  host: string
  user?: string
  onConfirm: (password: string) => void
  onCancel: () => void
}> = (props) => {
  const dialog = useDialog()
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string>()

  const handleSubmit = () => {
    if (!password().trim()) {
      setError("Password is required")
      return
    }
    props.onConfirm(password())
    dialog.close()
  }

  const handleCancel = () => {
    props.onCancel()
    dialog.close()
  }

  const hostDisplay = props.user ? `${props.user}@${props.host}` : props.host

  return (
    <Dialog
      title="SSH Password Required"
      description={`Enter password for ${hostDisplay}`}
      action={
        <div class="flex gap-2">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Connect</Button>
        </div>
      }
    >
      <div class="px-1.25 pb-1.25 space-y-4">
        <TextField
          type="password"
          label="Password"
          value={password()}
          onChange={(value) => {
            setPassword(value)
            setError(undefined)
          }}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              handleSubmit()
            }
          }}
          error={error()}
          autofocus
          required
        />
        <p class="text-12-regular text-text-weak">
          For better security, consider setting up SSH key-based authentication instead of passwords.
        </p>
      </div>
    </Dialog>
  )
}
