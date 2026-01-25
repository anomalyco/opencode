import { Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useGlobalSDK } from "@/context/global-sdk"
import { useProviders } from "@/hooks/use-providers"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogConnectProvider } from "./dialog-connect-provider"
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

// Provider OAuth multi-account support status
const OAUTH_MULTI_ACCOUNT_SUPPORT: Record<string, { supported: boolean; note?: string }> = {
  anthropic: { supported: true, note: "Claude Max/Pro subscription" },
  openai: { supported: true, note: "ChatGPT Plus/Pro subscription" },
  "github-copilot": { supported: true, note: "GitHub Copilot subscription" },
  google: { supported: false, note: "Contributions welcome" },
  openrouter: { supported: false, note: "API key only" },
  azure: { supported: false, note: "Service principal auth" },
  "amazon-bedrock": { supported: false, note: "AWS credential chain" },
  mistral: { supported: false, note: "API key only" },
  groq: { supported: false, note: "API key only" },
  xai: { supported: false, note: "API key only" },
  perplexity: { supported: false, note: "API key only" },
  cohere: { supported: false, note: "API key only" },
  deepinfra: { supported: false, note: "API key only" },
  cerebras: { supported: false, note: "API key only" },
  togetherai: { supported: false, note: "API key only" },
  "google-vertex": { supported: false, note: "Service account auth" },
  gitlab: { supported: false, note: "Token auth" },
  vercel: { supported: false, note: "API key only" },
}

interface BrowserSessionStatus {
  recordId: string
  isConfigured: boolean
  hasProfile: boolean
  lastRefresh?: string
}

// Provider detail view - shows accounts, usage, switch functionality
function ProviderDetailView(props: { providerID: string; providerName: string; onBack: () => void }) {
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const dialog = useDialog()
  const [switching, setSwitching] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal<string | null>(null)
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null)
  const [browserSessions, setBrowserSessions] = createSignal<Record<string, BrowserSessionStatus>>({})
  const [settingUpBrowser, setSettingUpBrowser] = createSignal<string | null>(null)
  const [refreshingBrowser, setRefreshingBrowser] = createSignal<string | null>(null)
  const [rebindingBrowser, setRebindingBrowser] = createSignal<string | null>(null)
  const [removingBrowser, setRemovingBrowser] = createSignal<string | null>(null)
  const [renamingAccount, setRenamingAccount] = createSignal<string | null>(null)
  const [renameInput, setRenameInput] = createSignal("")

  const doFetch = platform.fetch ?? fetch

  const [usage, { refetch, mutate }] = createResource(async () => {
    const result = await globalSDK.client.auth.usage({})
    const data = result.data as AuthUsageData
    // Also load browser sessions
    loadBrowserSessions()
    return data[props.providerID]
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
      } else {
        const error = await result.json().catch(() => ({ message: "Unknown error" }))
        alert(`Refresh failed: ${error.message || "Unknown error"}`)
      }
    } catch (e) {
      alert(`Refresh error: ${e}`)
    } finally {
      setRefreshingBrowser(null)
    }
  }

  const rebindBrowserSession = async (recordId: string) => {
    setRebindingBrowser(recordId)
    try {
      const result = await doFetch(`${globalSDK.url}/provider/auth/browser/sessions/${recordId}/setup`, {
        method: "POST",
      })
      if (result.ok) {
        await refetch()
        await loadBrowserSessions()
      } else {
        const error = await result.json().catch(() => ({ message: "Unknown error" }))
        alert(`Rebind failed: ${error.message || "Unknown error"}`)
      }
    } catch (e) {
      alert(`Rebind error: ${e}`)
    } finally {
      setRebindingBrowser(null)
    }
  }

  const startRename = (recordId: string, currentLabel?: string) => {
    setRenamingAccount(recordId)
    setRenameInput(currentLabel && currentLabel !== "default" ? currentLabel : "")
  }

  const cancelRename = () => {
    setRenamingAccount(null)
    setRenameInput("")
  }

  const submitRename = async (recordId: string) => {
    const label = renameInput().trim()
    if (!label) {
      cancelRename()
      return
    }
    try {
      const result = await doFetch(`${globalSDK.url}/provider/auth/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: props.providerID, recordID: recordId, label }),
      })
      if (result.ok) {
        await refetch()
      }
    } finally {
      cancelRename()
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
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  const switchAccount = async (recordID: string) => {
    setSwitching(recordID)
    try {
      const response = await doFetch(`${globalSDK.url}/auth/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: props.providerID, recordID }),
      })
      if (response.ok) {
        const result = await response.json()
        const current = usage()
        if (current && result.success) {
          // Update accounts list and usage data from response
          mutate({
            ...current,
            accounts: current.accounts.map((acc) => ({
              ...acc,
              isActive: acc.id === recordID,
            })),
            anthropicUsage: result.anthropicUsage ?? current.anthropicUsage,
          })
        }
      }
    } catch (e) {
      console.error("Failed to switch account:", e)
    } finally {
      setSwitching(null)
    }
  }

  const deleteAccount = async (recordID: string) => {
    setDeleting(recordID)
    try {
      const response = await doFetch(`${globalSDK.url}/auth/account`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: props.providerID, recordID }),
      })
      if (response.ok) {
        const result = await response.json()
        if (result.remaining === 0) {
          // Provider was disconnected, go back to list
          props.onBack()
        } else {
          await refetch()
        }
      }
    } catch (e) {
      console.error("Failed to delete account:", e)
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  const support = OAUTH_MULTI_ACCOUNT_SUPPORT[props.providerID]
  const isAnthropic = props.providerID === "anthropic"

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <button type="button" class="p-1 rounded hover:bg-fill-ghost-base transition-colors" onClick={props.onBack}>
          <Icon name="arrow-left" class="size-4 text-icon-muted" />
        </button>
        <ProviderIcon id={props.providerID as IconName} class="size-5" />
        <h3 class="text-14-medium text-text-strong">{props.providerName}</h3>
        <Show when={support?.supported}>
          <span class="text-10-medium text-fill-success-base bg-fill-success-ghost px-1.5 py-0.5 rounded">
            Multi-account
          </span>
        </Show>
      </div>

      <Show when={usage.loading}>
        <div class="flex items-center justify-center py-8">
          <Spinner />
        </div>
      </Show>

      <Show when={!usage.loading && usage()}>
        {(data) => (
          <>
            {/* Anthropic Usage Stats */}
            <Show when={isAnthropic && data().anthropicUsage}>
              <div class="flex flex-col gap-2 p-3 rounded-lg bg-fill-brand-ghost border border-fill-brand-base">
                <div class="text-12-medium text-text-strong">Rate Limits (Active Account)</div>
                <Show when={data().anthropicUsage?.fiveHour}>
                  <UsageBarPercent
                    label="5-Hour Limit"
                    utilization={data().anthropicUsage!.fiveHour!.utilization}
                    resetsAt={data().anthropicUsage!.fiveHour!.resetsAt}
                  />
                </Show>
                <Show when={data().anthropicUsage?.sevenDay}>
                  <UsageBarPercent
                    label="7-Day Limit (All Models)"
                    utilization={data().anthropicUsage!.sevenDay!.utilization}
                    resetsAt={data().anthropicUsage!.sevenDay!.resetsAt}
                  />
                </Show>
                <Show when={data().anthropicUsage?.sevenDaySonnet}>
                  <UsageBarPercent
                    label="7-Day Limit (Sonnet)"
                    utilization={data().anthropicUsage!.sevenDaySonnet!.utilization}
                    resetsAt={data().anthropicUsage!.sevenDaySonnet!.resetsAt}
                  />
                </Show>
              </div>
            </Show>

            {/* Account List */}
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <div class="text-12-medium text-text-muted">
                  Accounts ({data().accounts.length})
                  <Show when={data().accounts.length > 1 && support?.supported}>
                    <span class="text-text-weak"> - click to switch</span>
                  </Show>
                </div>
                <Show when={support?.supported && data().accounts.length > 1}>
                  <span class="text-10-medium text-fill-success-base">Auto-rotation enabled</span>
                </Show>
              </div>

              <div class="flex flex-col gap-1">
                <For each={data().accounts}>
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
                    const canSwitch = () =>
                      data().accounts.length > 1 && !account.isActive && !isSwitching() && support?.supported

                    return (
                      <div
                        class="flex items-center gap-2 p-2 rounded-md transition-all"
                        classList={{
                          "bg-surface-base": !account.isActive,
                          "bg-fill-success-ghost border border-fill-success-base": account.isActive,
                        }}
                      >
                        <Show
                          when={renamingAccount() === account.id}
                          fallback={
                            <div class="flex-1 flex items-center justify-between">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => canSwitch() && switchAccount(account.id)}
                                onKeyDown={(e) => e.key === "Enter" && canSwitch() && switchAccount(account.id)}
                                class="flex-1 flex items-center gap-2 cursor-pointer"
                                classList={{
                                  "hover:opacity-80": canSwitch(),
                                  "opacity-60 cursor-default": !canSwitch() && !account.isActive,
                                }}
                              >
                                <Show when={isSwitching()}>
                                  <Spinner class="size-3" />
                                </Show>
                                <span class="text-12-medium text-text-base">
                                  {account.label && account.label !== "default"
                                    ? account.label
                                    : `Account ${index() + 1}`}
                                </span>
                                <Show when={account.isActive}>
                                  <span class="text-10-medium text-fill-success-base">Active</span>
                                </Show>
                                <Show when={isInCooldown()}>
                                  <span class="text-10-medium text-fill-danger-base">
                                    Cooldown {cooldownRemaining()}
                                  </span>
                                </Show>
                              </div>
                              <div class="flex items-center gap-2">
                                <span class="text-11-regular text-text-muted">
                                  {account.health.successCount} requests
                                </span>
                                <button
                                  type="button"
                                  onClick={() => startRename(account.id, account.label)}
                                  class="p-1 rounded hover:bg-fill-ghost-strong text-icon-muted hover:text-text-base transition-colors"
                                  title="Rename account"
                                >
                                  <Icon name="edit" class="size-3" />
                                </button>
                              </div>
                            </div>
                          }
                        >
                          <div class="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              value={renameInput()}
                              onInput={(e) => setRenameInput(e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") submitRename(account.id)
                                if (e.key === "Escape") cancelRename()
                              }}
                              placeholder={`Account ${index() + 1}`}
                              class="flex-1 px-2 py-1 text-12-medium bg-fill-ghost-base border border-border-base rounded focus:outline-none focus:border-border-strong"
                              autofocus
                            />
                            <button
                              type="button"
                              onClick={() => submitRename(account.id)}
                              class="px-2 py-1 rounded text-10-medium bg-fill-interactive-base text-white hover:bg-fill-interactive-strong transition-colors"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelRename}
                              class="px-2 py-1 rounded text-10-medium bg-fill-ghost-strong text-text-base hover:bg-fill-ghost-base transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </Show>
                        {/* Delete button */}
                        <Show when={isConfirming()}>
                          <div class="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => deleteAccount(account.id)}
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
              </div>
            </div>

            {/* Auto-Relogin Section - only for Anthropic */}
            <Show when={isAnthropic}>
              <div class="p-4 rounded-lg border border-border-weak-base bg-fill-ghost-base">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <Icon name="sliders" class="size-4 text-icon-muted" />
                    <span class="text-13-medium text-text-strong">Auto-Relogin</span>
                  </div>
                  <span class="text-10-medium text-text-muted">Experimental</span>
                </div>
                <p class="text-11-regular text-text-muted mb-3">
                  Configure browser sessions for automatic token refresh when tokens expire overnight.
                </p>

                <div class="flex flex-col gap-2">
                  <For each={data().accounts}>
                    {(account, index) => {
                      const session = () => browserSessions()[account.id]
                      const isSettingUp = () => settingUpBrowser() === account.id
                      const isRefreshing = () => refreshingBrowser() === account.id
                      const isRemoving = () => removingBrowser() === account.id

                      return (
                        <div class="flex items-center justify-between p-2 rounded bg-surface-base">
                          <div class="flex items-center gap-2">
                            <span class="text-12-medium text-text-base">
                              {account.label && account.label !== "default" ? account.label : `Account ${index() + 1}`}
                            </span>
                            <Show
                              when={session()?.isConfigured}
                              fallback={<span class="text-10-medium text-text-muted">Not configured</span>}
                            >
                              <span class="text-10-medium text-fill-success-base">Enabled</span>
                              <Show when={session()?.lastRefresh}>
                                <span class="text-10-medium text-text-muted">
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
                                  {isSettingUp() ? "Setting up..." : "Setup"}
                                </button>
                              }
                            >
                              <button
                                type="button"
                                onClick={() => refreshBrowserSession(account.id)}
                                disabled={isRefreshing()}
                                class="text-11-medium text-text-interactive-base hover:text-text-interactive-strong transition-colors disabled:opacity-50"
                              >
                                {isRefreshing() ? "..." : "Test"}
                              </button>
                              <button
                                type="button"
                                onClick={() => rebindBrowserSession(account.id)}
                                disabled={rebindingBrowser() === account.id}
                                class="text-11-medium text-text-interactive-base hover:text-text-interactive-strong transition-colors disabled:opacity-50"
                              >
                                {rebindingBrowser() === account.id ? "..." : "Rebind"}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeBrowserSession(account.id)}
                                disabled={isRemoving()}
                                class="text-11-medium text-fill-danger-base hover:text-fill-danger-strong transition-colors disabled:opacity-50"
                              >
                                {isRemoving() ? "..." : "Remove"}
                              </button>
                            </Show>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>

                <p class="text-10-regular text-text-weak mt-3">
                  Setup opens a browser window where you log in to claude.ai. Sessions are stored locally.
                </p>
              </div>
            </Show>

            {/* Add Account Button */}
            <button
              type="button"
              class="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border-base hover:border-border-strong hover:bg-fill-ghost-base transition-colors"
              onClick={() => dialog.show(() => <DialogConnectProvider provider={props.providerID} />)}
            >
              <Icon name="plus-small" class="size-4 text-icon-muted" />
              <span class="text-13-medium text-text-muted">Add Account</span>
            </button>

            {/* Info box for non-Anthropic providers */}
            <Show when={!isAnthropic && support?.supported}>
              <div class="p-3 rounded-lg bg-fill-ghost-base border border-border-weak-base">
                <div class="text-11-regular text-text-muted">
                  Usage statistics are currently only available for Anthropic. Multi-account switching works for this
                  provider. Contributions for usage stats are welcome!
                </div>
              </div>
            </Show>

            {/* Refresh button */}
            <button
              type="button"
              class="text-12-regular text-text-muted hover:text-text-base transition-colors self-center"
              onClick={() => refetch()}
            >
              Refresh
            </button>
          </>
        )}
      </Show>

      <Show when={!usage.loading && !usage()}>
        <div class="text-13-regular text-text-muted py-4 p-3 rounded-lg bg-fill-ghost-base">
          No account data available.
        </div>
      </Show>
    </div>
  )
}

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const [view, setView] = createSignal<"list" | "add" | { detail: string }>("list")
  const [search, setSearch] = createSignal("")

  const connected = createMemo(() =>
    providers
      .all()
      .filter((p) => providers.connected().some((c) => c.id === p.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const available = createMemo(() => {
    const query = search().toLowerCase()
    return providers
      .all()
      .filter((p) => !query || p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query))
      .sort((a, b) => {
        const aPopular = ["anthropic", "openai", "github-copilot", "google", "openrouter"].includes(a.id)
        const bPopular = ["anthropic", "openai", "github-copilot", "google", "openrouter"].includes(b.id)
        if (aPopular && !bPopular) return -1
        if (!aPopular && bPopular) return 1
        return a.name.localeCompare(b.name)
      })
  })

  const detailProvider = createMemo(() => {
    const v = view()
    if (typeof v === "object" && "detail" in v) {
      return providers.all().find((p) => p.id === v.detail)
    }
    return undefined
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar" style={{ padding: "0 40px 40px 40px" }}>
      <div
        class="sticky top-0 z-10"
        style={{
          background:
            "linear-gradient(to bottom, var(--surface-raised-stronger-non-alpha) calc(100% - 24px), transparent)",
        }}
      >
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">Providers</h2>
        </div>
      </div>

      {/* Provider detail view */}
      <Show when={detailProvider()}>
        {(provider) => (
          <ProviderDetailView
            providerID={provider().id}
            providerName={provider().name}
            onBack={() => setView("list")}
          />
        )}
      </Show>

      {/* Add provider view */}
      <Show when={!detailProvider() && view() === "add"}>
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="p-1 rounded hover:bg-fill-ghost-base transition-colors"
              onClick={() => {
                setView("list")
                setSearch("")
              }}
            >
              <Icon name="arrow-left" class="size-4 text-icon-muted" />
            </button>
            <h3 class="text-14-medium text-text-strong">Add Provider</h3>
          </div>

          <input
            type="text"
            placeholder="Search providers..."
            class="w-full px-3 py-2 rounded-md bg-fill-ghost-base border border-border-base text-13-regular text-text-base placeholder:text-text-muted focus:outline-none focus:border-border-strong"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            autofocus
          />

          <div class="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
            <For each={available()}>
              {(provider) => {
                const isConnected = providers.connected().some((c) => c.id === provider.id)
                const support = OAUTH_MULTI_ACCOUNT_SUPPORT[provider.id]
                return (
                  <button
                    type="button"
                    class="flex items-center justify-between p-2 rounded-md bg-fill-ghost-base hover:bg-fill-ghost-strong transition-colors text-left"
                    onClick={() => dialog.show(() => <DialogConnectProvider provider={provider.id} />)}
                  >
                    <div class="flex items-center gap-2">
                      <ProviderIcon id={provider.id as IconName} class="size-5" />
                      <span class="text-13-medium text-text-base">{provider.name}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Show when={isConnected}>
                        <span class="text-10-medium text-fill-success-base">Connected</span>
                      </Show>
                      <Show when={support?.supported}>
                        <span class="text-10-medium text-text-muted">Multi-account</span>
                      </Show>
                      <Icon name="plus-small" class="size-4 text-icon-muted" />
                    </div>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* List view (default) */}
      <Show when={!detailProvider() && view() === "list"}>
        <div class="flex flex-col gap-4">
          <p class="text-12-regular text-text-muted">
            Manage your AI provider connections. Click on a provider to view accounts and usage.
          </p>

          <Show
            when={connected().length > 0}
            fallback={
              <div class="text-13-regular text-text-muted py-4 p-3 rounded-lg bg-fill-ghost-base">
                No providers connected yet. Add a provider to get started.
              </div>
            }
          >
            <div class="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
              <For each={connected()}>
                {(provider) => {
                  const support = OAUTH_MULTI_ACCOUNT_SUPPORT[provider.id]
                  return (
                    <button
                      type="button"
                      class="flex items-center justify-between p-3 rounded-lg bg-surface-raised-base hover:bg-fill-ghost-base transition-colors text-left"
                      onClick={() => setView({ detail: provider.id })}
                    >
                      <div class="flex items-center gap-3">
                        <ProviderIcon id={provider.id as IconName} class="size-6" />
                        <span class="text-14-medium text-text-base">{provider.name}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={support?.supported}>
                          <span class="text-10-medium text-fill-success-base bg-fill-success-ghost px-1.5 py-0.5 rounded">
                            Multi-account
                          </span>
                        </Show>
                        <span class="text-10-medium text-fill-success-base">Connected</span>
                        <Icon name="chevron-right" class="size-4 text-icon-muted" />
                      </div>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>

          <button
            type="button"
            class="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border-base hover:border-border-strong hover:bg-fill-ghost-base transition-colors"
            onClick={() => setView("add")}
          >
            <Icon name="plus-small" class="size-4 text-icon-muted" />
            <span class="text-13-medium text-text-muted">Add Provider</span>
          </button>

          <div class="p-3 rounded-lg bg-fill-brand-ghost border border-fill-brand-base">
            <div class="text-12-medium text-text-strong mb-1">Multi-Account OAuth Rotation</div>
            <p class="text-11-regular text-text-muted">
              For supported providers (Anthropic, OpenAI, GitHub Copilot), you can login with multiple accounts.
              OpenCode will automatically rotate between them when one account hits rate limits.
            </p>
          </div>
        </div>
      </Show>
    </div>
  )
}
