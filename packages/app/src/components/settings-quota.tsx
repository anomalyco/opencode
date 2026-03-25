import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Progress } from "@opencode-ai/ui/progress"
import { createSignal, onMount, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { SettingsList } from "./settings-list"

interface UsageWindow {
  usedPercent: number | null
  remainingPercent: number | null
  windowSeconds: number | null
  resetAfterSeconds: number | null
  resetAt: number | null
  resetAtFormatted: string | null
  resetAfterFormatted: string | null
  valueLabel: string | null
}

interface ProviderUsage {
  windows: Record<string, UsageWindow>
}

interface QuotaResult {
  providerId: string
  providerName: string
  ok: boolean
  configured: boolean
  usage: ProviderUsage | null
  error: string | null
  fetchedAt: number
}

export const SettingsQuota: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()

  const [quotaData, setQuotaData] = createSignal<QuotaResult[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  onMount(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await globalSDK.client.global.quota()
      if (response.data) {
        setQuotaData(response.data)
      }
    } catch (e) {
      console.error("Failed to fetch quota:", e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  })

  const formatQuota = (quota: QuotaResult): { label: string; percent: number; remaining: number }[] => {
    if (!quota.ok || !quota.usage?.windows) return []
    const windows = Object.entries(quota.usage.windows)
    if (windows.length === 0) return []
    const parts: { label: string; percent: number; remaining: number }[] = []
    for (const [name, win] of windows) {
      if (win.usedPercent !== null) {
        parts.push({ label: name, percent: win.usedPercent, remaining: 100 - win.usedPercent })
      } else if (win.remainingPercent !== null) {
        parts.push({ label: name, percent: 100 - win.remainingPercent, remaining: win.remainingPercent })
      }
    }
    return parts
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.quota.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px] flex-1">
        <Show
          when={!loading()}
          fallback={
            <SettingsList>
              <div class="py-4 text-14-regular text-text-weak">Loading...</div>
            </SettingsList>
          }
        >
          <Show when={error()}>
            <SettingsList>
              <div class="py-4 text-14-regular text-text-weak">{error()}</div>
            </SettingsList>
          </Show>

          <Show when={!error()}>
            <Show
              when={quotaData().length > 0}
              fallback={
                <SettingsList>
                  <div class="py-4 text-14-regular text-text-weak">{language.t("settings.quota.empty")}</div>
                </SettingsList>
              }
            >
              <SettingsList>
                <For each={quotaData()}>
                  {(quota) => {
                    const items = () => formatQuota(quota)
                    return (
                      <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                        <div class="flex flex-col gap-3 min-w-0 w-full">
                          <div class="flex items-center gap-3 min-w-0">
                            <ProviderIcon id={quota.providerId} class="size-5 shrink-0 icon-strong-base" />
                            <span class="text-14-medium text-text-strong truncate">{quota.providerName}</span>
                          </div>
                          <Show when={items().length > 0}>
                            <div class="flex flex-col gap-3 pl-8">
                              <For each={items()}>
                                {(item) => (
                                  <Progress value={item.percent} maxValue={100} showValueLabel>
                                    {item.label}
                                  </Progress>
                                )}
                              </For>
                            </div>
                          </Show>
                          <Show when={quota.error}>
                            <span class="text-12-regular text-text-weak pl-8">{quota.error}</span>
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </SettingsList>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
