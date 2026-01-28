import { invoke } from "@tauri-apps/api/core"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"

type ServerConfigDialogProps = {
  onSave?: (url: string) => void
  onCancel?: () => void
}

export function ServerConfigDialog(props: ServerConfigDialogProps) {
  const [store, setStore] = createStore({
    url: "",
    error: undefined as string | undefined,
    loading: false,
  })

  onMount(async () => {
    // Load existing server URL if any
    try {
      const existingUrl = await invoke<string | null>("get_server_url").catch(() => null)
      if (existingUrl) {
        setStore("url", existingUrl)
      }
    } catch (e) {
      console.error("Failed to load server URL:", e)
    }
  })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()

    const form = e.currentTarget as HTMLFormElement
    const formData = new FormData(form)
    const url = formData.get("serverUrl") as string

    if (!url?.trim()) {
      setStore("error", "Server URL cannot be empty")
      return
    }

    // Basic URL validation
    let normalizedUrl = url.trim()
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = `http://${normalizedUrl}`
    }

    try {
      new URL(normalizedUrl)
    } catch {
      setStore("error", "Invalid URL format")
      return
    }

    setStore("loading", true)
    setStore("error", undefined)

    try {
      await invoke("set_server_url", { url: normalizedUrl })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Server configuration saved",
        description: `Connected to ${normalizedUrl}`,
      })
      props.onSave?.(normalizedUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStore("error", `Failed to save: ${message}`)
    } finally {
      setStore("loading", false)
    }
  }

  async function handleClear() {
    try {
      await invoke("clear_server_url")
      setStore("url", "")
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Server configuration cleared",
        description: "Will use default server on next restart",
      })
    } catch (error) {
      showToast({
        variant: "error",
        icon: "circle-ban-sign",
        title: "Failed to clear configuration",
        description: String(error),
      })
    }
  }

  return (
    <Dialog title="Configure Backend Server">
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5">
          <div class="text-16-semibold text-text-strong mb-2">Backend Server Configuration</div>
          <div class="text-14-regular text-text-base">
            Configure the backend server URL for ZFlow to connect to. This will be used on application startup.
          </div>
        </div>

        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4 px-2.5">
          <TextField
            autofocus
            type="text"
            label="Server URL"
            placeholder="http://192.168.11.14:9999"
            name="serverUrl"
            value={store.url}
            onChange={(value) => setStore("url", value)}
            validationState={store.error ? "invalid" : undefined}
            error={store.error}
            helperText="Enter the full URL including protocol (http:// or https://)"
          />

          <div class="flex flex-row gap-2 w-full">
            <Button
              type="submit"
              size="large"
              variant="primary"
              disabled={store.loading}
              class="flex-1"
            >
              {store.loading ? "Saving..." : "Save Configuration"}
            </Button>

            <Button
              type="button"
              size="large"
              variant="secondary"
              onClick={handleClear}
              disabled={store.loading || !store.url}
            >
              Clear
            </Button>

            <Button
              type="button"
              size="large"
              variant="ghost"
              onClick={props.onCancel}
              disabled={store.loading}
            >
              Cancel
            </Button>
          </div>
        </form>

        <div class="px-2.5 text-12-regular text-text-subtle">
          <div class="font-semibold mb-1">Examples:</div>
          <ul class="list-disc list-inside space-y-1">
            <li>http://192.168.11.14:9999</li>
            <li>http://localhost:4096</li>
            <li>https://api.example.com</li>
          </ul>
        </div>
      </div>
    </Dialog>
  )
}
