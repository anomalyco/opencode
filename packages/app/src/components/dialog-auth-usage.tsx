import { Dialog } from "@opencode-ai/ui/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { createResource, For, Show, createMemo, createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"

interface AccountUsage {
  id: string
  label?: string
  isActive?: boolean
  health: {
    successCount: number
    failureCount: number
    lastStatusCode?: number
    cooldownUntil?: number
  }
}

interface BrowserSessionStatus {
  recordId: string
  isConfigured: boolean
  hasProfile: boolean
  lastRefresh?: string
}

interface AnthropicUsage {
  fiveHour?: { utilization: number; resetsAt?: string }
  sevenDay?: { utilization: number; resetsAt?: string }
  sevenDaySonnet?: { utilization: number; resetsAt?: string }
}

interface ProviderUsage {
  accounts: AccountUsage[]
  anthropicUsage?: AnthropicUsage
}

type AuthUsageData = Record<string, ProviderUsage>

function formatResetTime(resetAt?: string): string {
  if (!resetAt) return ""
  const reset = new Date(resetAt)
  const now = new Date()
  const diffMs = reset.getTime() - now.getTime()
  if (diffMs <= 0) return "now"

  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function getColorClass(percent: number): string {
  if (percent <= 50) return "bg-fill-success-base"
  if (percent <= 80) return "bg-fill-warning-base"
  return "bg-fill-danger-base"
}

function UsageBarPercent(props: { label: string; utilization: number; resetsAt?: string }) {
  return (
    <div class="flex flex-col gap-1">
      <div class="flex justify-between text-12-regular">
        <span class="text-text-base">{props.label}</span>
        <span class="text-text-muted">{props.utilization}% used</span>
      </div>
      <div class="h-2 w-full bg-fill-ghost-strong rounded-full overflow-hidden">
        <div
          class={`h-full rounded-full transition-all ${getColorClass(props.utilization)}`}
          style={{ width: `${props.utilization}%` }}
        />
      </div>
      <Show when={props.resetsAt}>
        <div class="text-11-regular text-text-muted text-right">Resets in {formatResetTime(props.resetsAt)}</div>
      </Show>
    </div>
  )
}

export function DialogAuthUsage() {
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const [switching, setSwitching] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal<string | null>(null)
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null)
  const [browserSessions, setBrowserSessions] = createSignal<Record<string, BrowserSessionStatus>>({})
  const [settingUpBrowser, setSettingUpBrowser] = createSignal<string | null>(null)
  const [refreshingBrowser, setRefreshingBrowser] = createSignal<string | null>(null)
  const [removingBrowser, setRemovingBrowser] = createSignal<string | null>(null)

  const doFetch = platform.fetch ?? fetch

  const [usage, { refetch, mutate }] = createResource(async () => {
    const result = await globalSDK.client.auth.usage({})
    return result.data as AuthUsageData
  })

  // Load browser sessions for all accounts
  const loadBrowserSessions = async () => {
    try {
      const result = await doFetch(`${globalSDK.url}/provider/auth/browser/sessions`)
      if (result.ok) {
        const sessions = (await result.json()) as BrowserSessionStatus[]
        const map: Record<string, BrowserSessionStatus> = {}
        for (const session of sessions) {
          map[session.recordId] = session
        }
        setBrowserSessions(map)
      }
    } catch {
      // Ignore errors
    }
  }

  // Load browser sessions when usage loads
  createResource(
    () => usage(),
    async () => {
      await loadBrowserSessions()
    },
  )

  const setupBrowserSession = async (recordId: string) => {
    setSettingUpBrowser(recordId)
    try {
      const result = await doFetch(`${globalSDK.url}/provider/auth/browser/sessions/${recordId}/setup`, {
        method: "POST",
      })
      if (result.ok) {
        await loadBrowserSessions()
      }
    } finally {
      setSettingUpBrowser(null)
    }
  }

  const refreshBrowserSession = async (recordId: string) => {
    setRefreshingBrowser(recordId)
    try {
      const result = await doFetch(`${globalSDK.url}/provider/auth/browser/sessions/${recordId}/refresh`, {
        method: "POST",
      })
      if (result.ok) {
        await refetch()
        await loadBrowserSessions()
      }
    } finally {
      setRefreshingBrowser(null)
    }
  }

  const removeBrowserSession = async (recordId: string) => {
    setRemovingBrowser(recordId)
    try {
      await doFetch(`${globalSDK.url}/provider/auth/browser/sessions/${recordId}`, {
        method: "DELETE",
      })
      await loadBrowserSessions()
    } finally {
      setRemovingBrowser(null)
    }
  }

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  const providers = createMemo(() => {
    const data = usage()
    if (!data) return []
    return Object.entries(data).filter(([_, info]) => info.accounts.length > 0)
  })

  const switchAccount = async (providerID: string, recordID: string) => {
    setSwitching(recordID)
    try {
      const result = await doFetch(`${globalSDK.url}/provider/auth/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID, recordID }),
      }).then((r) => r.json())

      if (result) {
        const current = usage()
        if (current && current[providerID]) {
          mutate({
            ...current,
            [providerID]: {
              ...current[providerID],
              accounts: current[providerID].accounts.map((acc) => ({
                ...acc,
                isActive: acc.id === recordID,
              })),
            },
          })
        }
      }
    } finally {
      setSwitching(null)
    }
  }

  const deleteAccount = async (providerID: string, recordID: string) => {
    setDeleting(recordID)
    try {
      const result = await doFetch(`${globalSDK.url}/provider/auth/account`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID, recordID }),
      }).then((r) => r.json())

      if (result.success) {
        if (result.remaining === 0) {
          // Provider was disconnected, refresh to remove from list
          await refetch()
        } else {
          // Update local state
          const current = usage()
          if (current && current[providerID]) {
            const remaining = current[providerID].accounts.filter((acc) => acc.id !== recordID)
            // If deleted account was active, mark first remaining as active
            const hadActive = current[providerID].accounts.find((acc) => acc.id === recordID)?.isActive
            if (hadActive && remaining.length > 0) {
              remaining[0].isActive = true
            }
            mutate({
              ...current,
              [providerID]: {
                ...current[providerID],
                accounts: remaining,
              },
            })
          }
        }
      }
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  return (
    <Dialog title="Rate Limits & Usage">
      <div class="flex flex-col gap-6 px-4 pb-4 min-w-[420px]">
        <Show when={usage.loading}>
          <div class="flex items-center justify-center py-8">
            <Spinner />
          </div>
        </Show>

        <Show when={!usage.loading && providers().length === 0}>
          <div class="text-14-regular text-text-muted py-4">
            No OAuth providers configured. Login with Claude Max or another OAuth provider to see usage data.
          </div>
        </Show>

        <For each={providers()}>
          {([providerID, info]) => (
            <div class="flex flex-col gap-4">
              <div class="flex items-center gap-2">
                <ProviderIcon id={providerID as IconName} class="size-5 shrink-0 icon-strong-base" />
                <span class="text-14-medium text-text-strong capitalize">{providerID}</span>
                <span class="text-12-regular text-text-muted">
                  ({info.accounts.length} account{info.accounts.length > 1 ? "s" : ""})
                </span>
              </div>

              {/* Anthropic Usage Limits */}
              <Show when={info.anthropicUsage}>
                <div class="flex flex-col gap-3 p-3 rounded-lg bg-fill-brand-ghost border border-fill-brand-base">
                  <div class="text-13-medium text-text-strong">Usage Limits (Active Account)</div>
                  <Show when={info.anthropicUsage?.fiveHour}>
                    <UsageBarPercent
                      label="5-Hour Limit"
                      utilization={info.anthropicUsage!.fiveHour!.utilization}
                      resetsAt={info.anthropicUsage!.fiveHour!.resetsAt}
                    />
                  </Show>
                  <Show when={info.anthropicUsage?.sevenDay}>
                    <UsageBarPercent
                      label="7-Day Limit (All Models)"
                      utilization={info.anthropicUsage!.sevenDay!.utilization}
                      resetsAt={info.anthropicUsage!.sevenDay!.resetsAt}
                    />
                  </Show>
                  <Show when={info.anthropicUsage?.sevenDaySonnet}>
                    <UsageBarPercent
                      label="7-Day Limit (Sonnet)"
                      utilization={info.anthropicUsage!.sevenDaySonnet!.utilization}
                      resetsAt={info.anthropicUsage!.sevenDaySonnet!.resetsAt}
                    />
                  </Show>
                </div>
              </Show>

              <Show when={!info.anthropicUsage && providerID === "anthropic"}>
                <div class="text-12-regular text-text-muted italic p-3 rounded-lg bg-fill-ghost-base">
                  Unable to fetch usage limits. Make sure you're logged in with Claude Max.
                </div>
              </Show>

              {/* Account Details */}
              <div class="text-12-medium text-text-muted">
                Accounts
                <Show when={info.accounts.length > 1}>
                  <span class="text-text-weak"> (click to switch)</span>
                </Show>
              </div>
              <For each={info.accounts}>
                {(account, index) => {
                  const isInCooldown = () => {
                    const cooldown = account.health.cooldownUntil
                    return cooldown && cooldown > Date.now()
                  }
                  const cooldownRemaining = () => {
                    const cooldown = account.health.cooldownUntil
                    if (!cooldown) return ""
                    const diff = cooldown - Date.now()
                    if (diff <= 0) return ""
                    const secs = Math.ceil(diff / 1000)
                    return secs > 60 ? `${Math.ceil(secs / 60)}m` : `${secs}s`
                  }
                  const isSwitching = () => switching() === account.id
                  const isDeleting = () => deleting() === account.id
                  const isConfirming = () => confirmDelete() === account.id
                  const canSwitch = () => info.accounts.length > 1 && !account.isActive && !isSwitching()

                  return (
                    <div
                      class="flex items-center gap-2 p-3 rounded-lg transition-all"
                      classList={{
                        "bg-fill-ghost-base": !account.isActive,
                        "bg-fill-success-ghost border border-fill-success-base": account.isActive,
                      }}
                    >
                      <button
                        type="button"
                        disabled={!canSwitch() && !account.isActive}
                        onClick={() => canSwitch() && switchAccount(providerID, account.id)}
                        class="flex-1 flex flex-col gap-2 text-left transition-all"
                        classList={{
                          "hover:opacity-80 cursor-pointer": canSwitch(),
                          "opacity-60": !canSwitch() && !account.isActive,
                        }}
                      >
                        <div class="flex justify-between items-center w-full">
                          <div class="flex items-center gap-2">
                            <Show when={isSwitching()}>
                              <Spinner class="size-3" />
                            </Show>
                            <span class="text-13-medium text-text-base">
                              Account {index() + 1}
                              <Show when={account.label && account.label !== "default"}>
                                <span class="text-text-muted"> ({account.label})</span>
                              </Show>
                            </span>
                            <Show when={account.isActive}>
                              <span class="text-10-medium text-fill-success-base bg-fill-success-ghost px-1.5 py-0.5 rounded">
                                Active
                              </span>
                            </Show>
                            <Show when={isInCooldown()}>
                              <span class="text-10-medium text-fill-danger-base bg-fill-danger-ghost px-1.5 py-0.5 rounded">
                                Cooldown {cooldownRemaining()}
                              </span>
                            </Show>
                          </div>
                          <span class="text-11-regular text-text-muted">{account.health.successCount} requests</span>
                        </div>

                        <Show when={account.health.failureCount > 0}>
                          <div class="text-11-regular text-fill-danger-base">
                            {account.health.failureCount} failed requests
                          </div>
                        </Show>
                      </button>

                      {/* Delete button */}
                      <Show when={isConfirming()}>
                        <div class="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => deleteAccount(providerID, account.id)}
                            disabled={isDeleting()}
                            class="px-2 py-1 rounded text-10-medium bg-fill-danger-base text-white hover:bg-fill-danger-strong transition-colors disabled:opacity-50"
                          >
                            <Show when={isDeleting()} fallback="Confirm">
                              <Spinner class="size-3" />
                            </Show>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            class="px-2 py-1 rounded text-10-medium bg-fill-ghost-strong text-text-base hover:bg-fill-ghost-base transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </Show>
                      <Show when={!isConfirming()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDelete(account.id)
                          }}
                          class="p-1 rounded hover:bg-fill-danger-ghost text-icon-muted hover:text-fill-danger-base transition-colors"
                          title="Remove account"
                        >
                          <Icon name="close" class="size-4" />
                        </button>
                      </Show>
                    </div>
                  )
                }}
              </For>

              {/* Auto-Relogin Section - Anthropic only */}
              <Show when={providerID === "anthropic"}>
                <div class="flex flex-col gap-3 p-4 rounded-lg border border-border-weak-base bg-fill-ghost-base">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <Icon name="settings-gear" class="size-4 text-icon-muted" />
                      <span class="text-13-medium text-text-strong">Auto-Relogin</span>
                    </div>
                    <span class="text-10-medium text-text-muted bg-fill-ghost-strong px-2 py-0.5 rounded">
                      Experimental
                    </span>
                  </div>

                  <p class="text-12-regular text-text-muted">
                    Configure browser sessions for automatic token refresh when tokens expire overnight.
                  </p>

                  <div class="flex flex-col gap-2">
                    <For each={info.accounts}>
                      {(account, index) => {
                        const session = () => browserSessions()[account.id]
                        const isSettingUp = () => settingUpBrowser() === account.id
                        const isRefreshing = () => refreshingBrowser() === account.id
                        const isRemoving = () => removingBrowser() === account.id

                        return (
                          <div class="flex items-center justify-between p-3 rounded-lg bg-fill-ghost-strong">
                            <div class="flex items-center gap-2">
                              <span class="text-12-medium text-text-base">Account {index() + 1}</span>
                              <Show
                                when={session()?.isConfigured}
                                fallback={<span class="text-11-regular text-text-muted">Not configured</span>}
                              >
                                <span class="text-11-medium text-fill-success-base">Enabled</span>
                                <Show when={session()?.lastRefresh}>
                                  <span class="text-11-regular text-text-muted">
                                    (refreshed {formatTimeAgo(session()!.lastRefresh!)})
                                  </span>
                                </Show>
                              </Show>
                            </div>

                            <div class="flex items-center gap-2">
                              <Show
                                when={session()?.isConfigured}
                                fallback={
                                  <button
                                    type="button"
                                    onClick={() => setupBrowserSession(account.id)}
                                    disabled={isSettingUp()}
                                    class="text-11-medium text-text-interactive-base hover:text-text-interactive-strong transition-colors disabled:opacity-50"
                                  >
                                    <Show when={isSettingUp()} fallback="Setup">
                                      <span class="flex items-center gap-1">
                                        <Spinner class="size-3" /> Setting up...
                                      </span>
                                    </Show>
                                  </button>
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() => refreshBrowserSession(account.id)}
                                  disabled={isRefreshing()}
                                  class="text-11-medium text-text-muted hover:text-text-base transition-colors disabled:opacity-50"
                                >
                                  <Show when={isRefreshing()} fallback="Test">
                                    <Spinner class="size-3" />
                                  </Show>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeBrowserSession(account.id)}
                                  disabled={isRemoving()}
                                  class="text-11-medium text-fill-danger-base hover:text-fill-danger-strong transition-colors disabled:opacity-50"
                                >
                                  <Show when={isRemoving()} fallback="Remove">
                                    <Spinner class="size-3" />
                                  </Show>
                                </button>
                              </Show>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>

                  <p class="text-11-regular text-text-weak">
                    Setup opens a browser window where you log in to claude.ai. Sessions are stored locally.
                  </p>
                </div>
              </Show>
            </div>
          )}
        </For>

        <Show when={!usage.loading && providers().length > 0}>
          <div class="flex justify-center pt-2 border-t border-border-weak-base">
            <button
              type="button"
              class="text-12-regular text-text-muted hover:text-text-base transition-colors"
              onClick={() => refetch()}
            >
              Refresh
            </button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
