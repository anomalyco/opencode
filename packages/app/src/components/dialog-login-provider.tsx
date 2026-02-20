import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function DialogLoginProvider(props: { initialUrl?: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const language = useLanguage()
  const [url, setUrl] = createSignal(props.initialUrl ?? "")
  const [loading, setLoading] = createSignal(false)

  async function handleLogin() {
    const value = url().trim()
    if (!value) {
      showToast({ title: "URL is required", variant: "error" })
      return
    }
    setLoading(true)
    try {
      const response = await fetch(`${sdk.url}/auth/wellknown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Unknown error" }))
        throw new Error(error.data?.message || error.message || "Login failed")
      }
      const result = await response.json()
      showToast({
        title: language.t("provider.login.success"),
        description: result.message || `Logged in to ${value}`,
        variant: "success",
      })
      dialog.close()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed"
      showToast({ title: language.t("provider.login.failed"), description: message, variant: "error" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      title={language.t("provider.login.title")}
      description={language.t("provider.login.description")}
    >
      <div class="flex flex-col gap-4">
        <TextField
          placeholder="https://gateway.example.com"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter") handleLogin()
          }}
          autofocus
        />
        <div class="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button onClick={handleLogin} disabled={loading()}>
            {loading() ? language.t("common.loading") : language.t("provider.login.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
