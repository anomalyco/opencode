import { Component, createResource, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useSDK } from "@/context/sdk"
import { usePlatform } from "@/context/platform"

interface AccountEntry {
  id: string
  provider: string
  type: "oauth" | "api" | "wellknown" | "multi"
  email?: string
  accountId?: string
  status: "active" | "rate_limited" | "cooling_down" | "unknown"
  index?: number
  isActive?: boolean
  lastUsed?: number
}

export const DialogShowAccounts: Component = () => {
  const sdk = useSDK()
  const platform = usePlatform()

  const [accounts] = createResource(async (): Promise<AccountEntry[]> => {
    if (!platform.fetch) return []
    const url = `${sdk.url}/account?directory=${encodeURIComponent(sdk.directory)}`
    const res = await platform.fetch(url)
    if (!res.ok) return []
    return res.json()
  })

  const statusSymbol = (status: AccountEntry["status"]) => {
    switch (status) {
      case "active":
        return "●"
      case "rate_limited":
        return "◐"
      case "cooling_down":
        return "◐"
      default:
        return "○"
    }
  }

  const statusColor = (status: AccountEntry["status"]) => {
    switch (status) {
      case "active":
        return "text-success"
      case "rate_limited":
        return "text-warning"
      case "cooling_down":
        return "text-warning"
      default:
        return "text-text-weak"
    }
  }

  const typeLabel = (type: AccountEntry["type"]) => {
    switch (type) {
      case "oauth":
        return "OAuth"
      case "api":
        return "API Key"
      case "wellknown":
        return "Auto"
      case "multi":
        return "Multi"
      default:
        return type
    }
  }

  return (
    <Dialog title="Accounts" description="Configured authentication accounts">
      <Show when={accounts.loading}>
        <div class="p-4 text-center text-text-weak">Loading...</div>
      </Show>
      <Show when={accounts.error}>
        <div class="p-4 text-center text-error">Failed to load accounts</div>
      </Show>
      <Show when={!accounts.loading && !accounts.error && accounts()}>
        <div class="flex flex-col gap-2 p-2">
          <Show when={accounts()!.length === 0}>
            <div class="p-4 text-center text-text-weak">No accounts configured</div>
          </Show>
          <For each={accounts()}>
            {(account) => (
              <div class="flex items-center gap-3 px-3 py-2 rounded-md bg-surface-secondary">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-14-medium truncate">{account.provider}</span>
                    <Show when={account.isActive}>
                      <span class="text-12-regular text-accent">★</span>
                    </Show>
                    <Show when={account.index}>
                      <span class="text-11-regular text-text-weak">#{account.index}</span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-2 text-12-regular text-text-weak">
                    <span>{typeLabel(account.type)}</span>
                    <Show when={account.email || account.accountId}>
                      <span>·</span>
                      <span class="truncate">{account.email || account.accountId}</span>
                    </Show>
                  </div>
                </div>
                <div class={`flex items-center gap-1 ${statusColor(account.status)}`}>
                  <span>{statusSymbol(account.status)}</span>
                  <span class="text-12-regular capitalize">{account.status.replace("_", " ")}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Dialog>
  )
}
