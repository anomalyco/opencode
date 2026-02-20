import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"

interface DialogLoginProps {
  initialUrl?: string
}

export function DialogLogin(props: DialogLoginProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  return (
    <DialogPrompt
      title="Login to Provider"
      placeholder="https://example.com"
      value={props.initialUrl}
      description={() => (
        <text>
          Enter the base URL of your provider (e.g. https://gateway.example.com)
        </text>
      )}
      onConfirm={async (url) => {
        if (!url || !url.trim()) {
          toast.show({ message: "URL is required", variant: "error" })
          return
        }
        dialog.clear()
        toast.show({ message: `Logging in to ${url}...`, variant: "info" })
        try {
          const response = await sdk.fetch(`${sdk.url}/auth/wellknown`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url.trim() }),
          })
          if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Unknown error" }))
            throw new Error(error.data?.message || error.message || "Login failed")
          }
          const result = await response.json()
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          toast.show({ message: result.message || `Logged in to ${url}`, variant: "success", duration: 5000 })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Login failed"
          toast.show({ message, variant: "error", duration: 5000 })
        }
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
