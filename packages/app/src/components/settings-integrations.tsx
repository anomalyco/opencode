import { Component, createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"

type PennylaneHealth = {
  healthy: boolean
  configured: boolean
  code: string
  message?: string
  error?: string
  hint?: string
}

function PennylaneLogo(props: { class?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
    >
      <circle cx="100" cy="100" r="88" stroke="#3C5068" stroke-width="24" fill="none" />
      <circle cx="82" cy="100" r="36" fill="#2CED71" />
      <circle cx="118" cy="100" r="36" fill="#0A7B5A" />
      <path
        d="M100 70.72C107.55 77.02 112.36 86.42 112.36 97C112.36 107.58 107.55 116.98 100 123.28C92.45 116.98 87.64 107.58 87.64 97C87.64 86.42 92.45 77.02 100 70.72Z"
        fill="#0A7B5A"
        opacity="0.6"
      />
    </svg>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}

export const SettingsIntegrations: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  const [pennylaneHealth, setPennylaneHealth] = createSignal<PennylaneHealth | undefined>(undefined)
  const [apiKey, setApiKey] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const refreshHealth = async () => {
    try {
      const result = await globalSDK.client.plugin.pennylane.health()
      setPennylaneHealth(result.data ?? undefined)
    } catch {
      setPennylaneHealth(undefined)
    }
  }

  createEffect(() => {
    void refreshHealth()
    const interval = setInterval(() => void refreshHealth(), 10_000)
    onCleanup(() => clearInterval(interval))
  })

  const healthy = () => pennylaneHealth()?.healthy === true
  const configured = () => pennylaneHealth()?.configured === true

  const saveApiKey = async () => {
    const key = apiKey().trim()
    if (!key) return
    setSaving(true)
    try {
      const res = await fetcher(`${globalSDK.url}/plugin/pennylane/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `Failed: ${res.status}`)
      }
      const health = await res.json()
      setPennylaneHealth(health)
      setApiKey("")
      showToast({
        variant: health.healthy ? "success" : "error",
        icon: health.healthy ? "circle-check" : undefined,
        title: health.healthy ? "Pennylane connected" : "API key saved",
        description: health.healthy ? "Integration is now active" : (health.message ?? "Connection failed"),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: "Failed to save API key",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">Integrations</h2>
          <p class="text-12-regular text-text-weak">Connect external services to your workspace</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Pennylane */}
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-3 pb-3">
            <PennylaneLogo class="size-7 shrink-0" />
            <div class="flex-1 min-w-0">
              <h3 class="text-14-medium text-text-strong">Pennylane</h3>
              <p class="text-12-regular text-text-weak">Accounting & invoicing</p>
            </div>
            <div class="flex items-center gap-1.5">
              <div
                classList={{
                  "size-2 rounded-full shrink-0": true,
                  "bg-icon-success-base": healthy(),
                  "bg-icon-critical-base": configured() && !healthy(),
                  "bg-border-weak-base": !configured(),
                }}
              />
              <span class="text-12-medium text-text-dimmed">
                {healthy()
                  ? language.t("status.pennylane.connected")
                  : configured()
                    ? language.t("status.pennylane.disconnected")
                    : language.t("status.pennylane.notConfigured")}
              </span>
            </div>
          </div>

          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title="API Key"
              description="Your Pennylane API token for authentication"
            >
              <div class="flex items-center gap-2">
                <Show when={healthy()}>
                  <span class="text-12-regular text-text-dimmed mr-1">********</span>
                </Show>
                <TextField
                  type="password"
                  placeholder={healthy() ? "Replace key..." : "Enter API key..."}
                  value={apiKey()}
                  onInput={(e: InputEvent) => setApiKey((e.target as HTMLInputElement).value)}
                  class="w-52"
                />
                <Button
                  variant="primary"
                  size="small"
                  disabled={!apiKey().trim() || saving()}
                  onClick={saveApiKey}
                >
                  {saving() ? "Saving..." : "Save"}
                </Button>
              </div>
            </SettingsRow>
          </div>
        </div>
      </div>
    </div>
  )
}
