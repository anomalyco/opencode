import { createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useServer } from "@/context/server"

interface ManageTwoFactorDialogProps {
  onUpdate?: () => void
}

/**
 * Dialog for managing 2FA when already enabled.
 */
export function ManageTwoFactorDialog(props: ManageTwoFactorDialogProps) {
  const dialog = useDialog()
  const server = useServer()
  const [confirmAction, setConfirmAction] = createSignal<"reset" | "disable" | null>(null)
  const [isWorking, setIsWorking] = createSignal(false)

  function getCsrfToken(): string | undefined {
    const match = document.cookie.match(/opencode_csrf=([^;]+)/)
    return match ? match[1] : undefined
  }

  async function handleReset(): Promise<void> {
    if (isWorking()) return
    const url = server.url
    if (!url) return

    setIsWorking(true)
    try {
      const res = await fetch(`${url}/auth/2fa/reset`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          ...(getCsrfToken() ? { "X-CSRF-Token": getCsrfToken()! } : {}),
        },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast({
          title: "Failed to reset 2FA",
          description: body?.message ?? "Please try again.",
        })
        return
      }

      showToast({
        title: "2FA reset",
        description: "Your 2FA configuration has been removed.",
      })
      props.onUpdate?.()
      dialog.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Please try again."
      showToast({ title: "Failed to reset 2FA", description: message })
    } finally {
      setIsWorking(false)
    }
  }

  async function handleDisable(): Promise<void> {
    if (isWorking()) return
    const url = server.url
    if (!url) return

    setIsWorking(true)
    try {
      const res = await fetch(`${url}/auth/2fa/disable`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          ...(getCsrfToken() ? { "X-CSRF-Token": getCsrfToken()! } : {}),
        },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast({
          title: "Failed to disable 2FA",
          description: body?.message ?? "Please try again.",
        })
        return
      }

      showToast({
        title: "2FA disabled",
        description: "You will not be prompted to set up 2FA again.",
      })
      props.onUpdate?.()
      dialog.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Please try again."
      showToast({ title: "Failed to disable 2FA", description: message })
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Dialog title="Manage 2FA" description="Review or reset your two-factor authentication settings.">
      <div class="flex flex-col gap-4 px-2 pb-3">
        <div class="flex flex-col gap-2 rounded-md border border-border-weak-base p-3 text-14-regular text-text-weak">
          <div class="text-text-strong text-14-medium">Two-factor authentication is enabled.</div>
          <div>
            Resetting 2FA removes your current authenticator setup. You will need to set it up again next time you sign
            in.
          </div>
          <div>Disabling 2FA removes your configuration and stops future setup prompts.</div>
        </div>

        <Show
          when={confirmAction() !== null}
          fallback={
            <div class="flex justify-end gap-2 pt-2">
              <Button size="large" variant="ghost" onClick={() => dialog.close()}>
                Close
              </Button>
              <Button size="large" variant="ghost" onClick={() => setConfirmAction("disable")}>
                Disable 2FA
              </Button>
              <Button size="large" variant="secondary" onClick={() => setConfirmAction("reset")}>
                Reset 2FA
              </Button>
            </div>
          }
        >
          <div class="flex flex-col gap-2 rounded-md border border-border-weak-base p-3 text-14-regular">
            <div class="text-text-strong text-14-medium">
              {confirmAction() === "disable" ? "Confirm disable" : "Confirm reset"}
            </div>
            <div class="text-text-weak">
              {confirmAction() === "disable"
                ? "You will not be prompted to set up 2FA again unless you re-enable it."
                : "This will disable 2FA until you set it up again."}
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <Button size="large" variant="ghost" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button
                size="large"
                variant="secondary"
                onClick={confirmAction() === "disable" ? handleDisable : handleReset}
                disabled={isWorking()}
              >
                {isWorking()
                  ? confirmAction() === "disable"
                    ? "Disabling..."
                    : "Resetting..."
                  : confirmAction() === "disable"
                    ? "Confirm disable"
                    : "Confirm reset"}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
