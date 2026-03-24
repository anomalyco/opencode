import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, type Component, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { SettingsList } from "./settings-list"

const DEFAULT_THRESHOLD = 80
const MIN_THRESHOLD = 5
const MAX_THRESHOLD = 95

function clampPercent(value: number) {
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(value)))
}

export const SettingsSessions: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const [store, setStore] = createStore({
    threshold: String(DEFAULT_THRESHOLD),
    dirty: false,
    savingThreshold: false,
    savingAuto: false,
  })

  const compaction = createMemo(() => globalSync.data.config.compaction)
  const auto = createMemo(() => compaction()?.auto ?? true)
  const thresholdPercent = createMemo(() => Math.round((compaction()?.threshold ?? 0.8) * 100))

  createEffect(() => {
    if (store.dirty) return
    setStore("threshold", String(thresholdPercent()))
  })

  const parsedThreshold = createMemo(() => {
    const value = Number(store.threshold)
    if (!Number.isFinite(value)) return undefined
    return clampPercent(value)
  })

  const thresholdChanged = createMemo(() => parsedThreshold() !== undefined && parsedThreshold() !== thresholdPercent())

  const updateCompaction = async (patch: NonNullable<typeof globalSync.data.config.compaction>) => {
    const before = globalSync.data.config.compaction
    const next = { ...before, ...patch }
    globalSync.set("config", "compaction", next)
    try {
      await globalSync.updateConfig({ compaction: next })
    } catch (err: unknown) {
      globalSync.set("config", "compaction", before)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
      throw err
    }
  }

  const saveThreshold = async () => {
    const value = parsedThreshold()
    if (value === undefined) return
    setStore("savingThreshold", true)
    try {
      await updateCompaction({ threshold: value / 100 })
      setStore({ dirty: false, threshold: String(value) })
    } finally {
      setStore("savingThreshold", false)
    }
  }

  const resetThreshold = async () => {
    setStore({ threshold: String(DEFAULT_THRESHOLD), dirty: true })
    await saveThreshold()
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">Sessions</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Compaction</h3>

          <SettingsList>
            <SettingsRow
              title="Auto-compact"
              description="Automatically compact sessions before they hit the model context limit."
            >
              <div data-action="settings-session-auto-compact">
                <Switch
                  checked={auto()}
                  disabled={store.savingAuto}
                  onChange={(checked) => {
                    setStore("savingAuto", true)
                    void updateCompaction({ auto: checked }).finally(() => setStore("savingAuto", false))
                  }}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title="Auto-compact threshold"
              description="Choose how full a session context should get before OpenCode compacts it automatically."
            >
              <div
                class="flex w-full flex-col gap-3 sm:w-[340px]"
                data-action="settings-session-auto-compact-threshold"
              >
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min={MIN_THRESHOLD}
                    max={MAX_THRESHOLD}
                    step="1"
                    value={parsedThreshold() ?? thresholdPercent()}
                    disabled={!auto() || store.savingThreshold}
                    class="h-2 w-full accent-text-interactive-base disabled:opacity-50"
                    onInput={(event) => {
                      setStore({ threshold: event.currentTarget.value, dirty: true })
                    }}
                  />
                  <div class="w-20 shrink-0">
                    <TextField
                      type="number"
                      value={store.threshold}
                      min={MIN_THRESHOLD}
                      max={MAX_THRESHOLD}
                      step="1"
                      inputmode="numeric"
                      disabled={!auto() || store.savingThreshold}
                      onInput={(event) => {
                        setStore({ threshold: event.currentTarget.value.replace(/[^\d]/g, ""), dirty: true })
                      }}
                    />
                  </div>
                  <span class="w-8 text-right text-12-medium text-text-weak">%</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span class="text-12-regular text-text-weak">Default: {DEFAULT_THRESHOLD}%</span>
                  <div class="flex items-center gap-2">
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={!auto() || store.savingThreshold || thresholdPercent() === DEFAULT_THRESHOLD}
                      onClick={() => void resetThreshold()}
                    >
                      Reset
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={
                        !auto() || store.savingThreshold || parsedThreshold() === undefined || !thresholdChanged()
                      }
                      onClick={() => void saveThreshold()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
