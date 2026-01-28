import { Component, createSignal, onMount, Show } from "solid-js"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

export const SettingsBackend: Component = () => {
  const platform = usePlatform()
  const language = useLanguage()

  const [serverUrl, setServerUrl] = createSignal("")
  const [hasConfig, setHasConfig] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const isDesktop = () => platform.platform === "desktop"

  onMount(async () => {
    if (!isDesktop()) return

    if (platform.getServerUrl) {
      const url = await platform.getServerUrl().catch(() => null)
      setServerUrl(url ?? "")
      setHasConfig(!!url)
    }
  })

  async function handleSave() {
    const url = serverUrl().trim()

    if (!url) {
      setError("Server URL cannot be empty")
      return
    }

    // Basic URL validation
    let normalizedUrl = url
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = `http://${normalizedUrl}`
    }

    try {
      new URL(normalizedUrl)
    } catch {
      setError("Invalid URL format")
      return
    }

    setLoading(true)
    setError(undefined)

    try {
      if (platform.setServerUrl) {
        await platform.setServerUrl(normalizedUrl)
      }
      setHasConfig(true)
      setServerUrl(normalizedUrl)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Backend configuration saved",
        description: `Connected to ${normalizedUrl}`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`Failed to save: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleClear() {
    if (!platform.clearServerUrl) return

    setLoading(true)
    try {
      await platform.clearServerUrl()
      setServerUrl("")
      setHasConfig(false)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Backend configuration cleared",
        description: "Will use default server on next restart",
      })
    } catch (err) {
      showToast({
        variant: "error",
        icon: "circle-ban-sign",
        title: "Failed to clear configuration",
        description: String(err),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Show when={isDesktop()} fallback={<div class="text-14-regular text-text-base">This feature is only available on desktop.</div>}>
      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-2">
          <div class="text-16-semibold text-text-strong">Backend Server Configuration</div>
          <div class="text-14-regular text-text-base">
            Configure the backend server that ZFlow connects to on startup. This setting persists across app
            restarts.
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <TextField
            type="text"
            label="Server URL"
            placeholder="http://192.168.11.14:9999"
            value={serverUrl()}
            onChange={setServerUrl}
            validationState={error() ? "invalid" : undefined}
            error={error()}
            helperText="Enter the full URL including protocol (http:// or https://)"
          />

          <div class="flex flex-row gap-2">
            <Button
              size="large"
              variant="primary"
              onClick={handleSave}
              disabled={loading()}
            >
              {loading() ? "Saving..." : "Save Configuration"}
            </Button>

            <Button
              size="large"
              variant="secondary"
              onClick={handleClear}
              disabled={loading() || !hasConfig()}
            >
              Clear
            </Button>
          </div>
        </div>

        <div class="flex flex-col gap-3 border-t border-border-base pt-6">
          <div class="text-14-semibold text-text-strong">Examples</div>
          <div class="text-12-regular text-text-subtle space-y-2">
            <div class="flex items-start gap-2">
              <Icon name="server" class="size-4 mt-0.5" />
              <div>
                <div class="font-medium">Local network server</div>
                <div class="font-mono">http://192.168.11.14:9999</div>
              </div>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="home" class="size-4 mt-0.5" />
              <div>
                <div class="font-medium">Local development server</div>
                <div class="font-mono">http://localhost:4096</div>
              </div>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="cloud" class="size-4 mt-0.5" />
              <div>
                <div class="font-medium">Remote server (HTTPS)</div>
                <div class="font-mono">https://api.example.com</div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2 border-t border-border-base pt-6">
          <div class="text-14-semibold text-text-strong">Status</div>
          <div class="flex items-center gap-2">
            <div
              class={`w-2 h-2 rounded-full ${
                hasConfig() ? "bg-success-base" : "bg-text-weak"
              }`}
            />
            <div class="text-12-regular text-text-subtle">
              {hasConfig() ? "Backend server configured" : "Using default server configuration"}
            </div>
          </div>
          {serverUrl() && (
            <div class="text-12-regular font-mono text-text-subtle truncate">{serverUrl()}</div>
          )}
        </div>
      </div>
    </Show>
  )
}
