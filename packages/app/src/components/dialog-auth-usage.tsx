import { Dialog } from "@opencode-ai/ui/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { Spinner } from "@opencode-ai/ui/spinner"
import { createResource, For, Show, createMemo } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"

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

export function DialogAuthUsage() {
  const globalSDK = useGlobalSDK()

  const [usage, { refetch }] = createResource(async () => {
    const result = await globalSDK.client.auth.usage({})
    return result.data as AuthUsageData
  })

  const providers = createMemo(() => {
    const data = usage()
    if (!data) return []
    return Object.entries(data).filter(([_, info]) => info.accounts.length > 0)
  })

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
                  <div class="text-13-medium text-text-strong">Usage Limits</div>
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
              <div class="text-12-medium text-text-muted">Accounts</div>
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

                  return (
                    <div
                      class="flex flex-col gap-2 p-3 rounded-lg"
                      classList={{
                        "bg-fill-ghost-base": !account.isActive,
                        "bg-fill-success-ghost border border-fill-success-base": account.isActive,
                      }}
                    >
                      <div class="flex justify-between items-center">
                        <div class="flex items-center gap-2">
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
                    </div>
                  )
                }}
              </For>
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
