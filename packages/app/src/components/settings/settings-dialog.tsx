import { createMemo, createSignal, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { base64Decode } from "@opencode-ai/util/encode"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { DialogConnectProvider } from "@/components/dialog-connect-provider"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { SshKeysDialog } from "./ssh-keys-dialog"

function normalizeProviders(data: ProviderListResponse): ProviderListResponse {
  return {
    ...data,
    all: data.all.map((provider) => ({
      ...provider,
      models: Object.fromEntries(Object.entries(provider.models).filter(([, info]) => info.status !== "deprecated")),
    })),
  }
}

function errorMessage(err: unknown) {
  if (err && typeof err === "object") {
    if ("data" in err) {
      const data = (err as { data?: { error?: { message?: string } } }).data
      if (data?.error?.message) return data.error.message
    }
    if ("error" in err) {
      const error = (err as { error?: { message?: string } }).error
      if (error?.message) return error.message
    }
    if ("message" in err && typeof (err as { message?: unknown }).message === "string") {
      return (err as { message: string }).message
    }
  }
  if (err instanceof Error) return err.message
  return "Request failed"
}

function OpenRouterFreeSettings() {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const params = useParams()
  const [saving, setSaving] = createSignal(false)

  const directory = createMemo(() => (params.dir ? base64Decode(params.dir) : ""))
  const workspace = createMemo(() => (directory() ? globalSync.child(directory()) : undefined))
  const workspaceStore = createMemo(() => workspace()?.[0])
  const setWorkspaceStore = createMemo(() => workspace()?.[1])

  const openrouterConfig = createMemo(() => workspaceStore()?.config?.openrouter ?? {})
  const hasOpenRouterKey = createMemo(() => !!workspaceStore()?.provider?.connected?.includes("openrouter"))

  const canUpdate = createMemo(() => !!directory())
  const canToggle = createMemo(() => canUpdate() && hasOpenRouterKey())

  const updateConfig = async (next: { freeRouter?: boolean; freeVariants?: boolean }) => {
    if (saving()) return
    if (!canUpdate()) {
      showToast({ title: "Open a project", description: "Open a project to update OpenRouter settings." })
      return
    }
    setSaving(true)
    try {
      const current = openrouterConfig()
      const payload = {
        openrouter: {
          freeRouter: current.freeRouter ?? false,
          freeVariants: current.freeVariants ?? false,
          ...next,
        },
      }
      await globalSDK.client.config.update({ directory: directory(), config: payload })
      const [configResult, providerResult] = await Promise.all([
        globalSDK.client.config.get({ directory: directory() }),
        globalSDK.client.provider.list({ directory: directory() }),
      ])
      const setStore = setWorkspaceStore()
      if (setStore) {
        if (configResult.data) setStore("config", configResult.data)
        if (providerResult.data) setStore("provider", normalizeProviders(providerResult.data))
      }
      showToast({ title: "OpenRouter settings updated" })
    } catch (err) {
      showToast({ title: "Failed to update OpenRouter settings", description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="flex flex-col gap-4 rounded-md border border-border-weak-base p-4">
      <div class="flex flex-col gap-1">
        <div class="text-14-medium text-text-strong">OpenRouter Free</div>
        <div class="text-12-regular text-text-weak">
          Requires an OpenRouter API key. Free models may be rate-limited or have reduced availability.
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <Show when={hasOpenRouterKey()}>
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-1">
              <div class="text-13-medium text-text-strong">Enable openrouter/free router</div>
              <div class="text-12-regular text-text-weak">Routes requests to a rotating pool of free models.</div>
            </div>
            <Switch
              checked={!!openrouterConfig().freeRouter}
              disabled={saving() || !canToggle()}
              onChange={(checked) => updateConfig({ freeRouter: checked })}
            />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-1">
              <div class="text-13-medium text-text-strong">Enable :free variants</div>
              <div class="text-12-regular text-text-weak">Adds free variants alongside paid OpenRouter models.</div>
            </div>
            <Switch
              checked={!!openrouterConfig().freeVariants}
              disabled={saving() || !canToggle()}
              onChange={(checked) => updateConfig({ freeVariants: checked })}
            />
          </div>
        </Show>
        <Show when={canUpdate() && !hasOpenRouterKey()}>
          <div class="text-12-regular text-text-weak">
            Connect OpenRouter to reveal free model settings.
          </div>
        </Show>
        <div class="flex items-center justify-between gap-3">
          <div class="text-12-regular text-text-weak">Need an API key to use OpenRouter?</div>
          <Button
            size="normal"
            variant="ghost"
            onClick={() =>
              dialog.show(() => <DialogConnectProvider provider="openrouter" onBack={() => dialog.show(() => <SettingsDialog />)} />)
            }
          >
            Connect OpenRouter
          </Button>
        </div>
        <Show when={!canUpdate()}>
          <div class="text-12-regular text-text-weak">Open a project to configure OpenRouter settings.</div>
        </Show>
      </div>
    </div>
  )
}

function ConnectProviderSettings() {
  const dialog = useDialog()

  return (
    <div class="flex flex-col gap-4 rounded-md border border-border-weak-base p-4">
      <div class="flex flex-col gap-1">
        <div class="text-14-medium text-text-strong">Providers</div>
        <div class="text-12-regular text-text-weak">Connect API keys for supported providers.</div>
      </div>
      <div class="flex items-center justify-between gap-3">
        <div class="text-12-regular text-text-weak">Manage your provider connections.</div>
        <Button
          size="normal"
          variant="ghost"
          onClick={() => dialog.show(() => <DialogSelectProvider />)}
        >
          Connect provider
        </Button>
      </div>
    </div>
  )
}

export function SettingsDialog() {
  const dialog = useDialog()

  return (
    <Dialog title="Settings" description="Manage your OpenCode settings." class="max-w-[720px]">
      <div class="flex flex-col gap-4 px-2 pb-3">
        <ConnectProviderSettings />
        <OpenRouterFreeSettings />
        <SshKeysDialog />
        <div class="flex justify-end gap-2 pt-2">
          <Button size="large" variant="ghost" onClick={() => dialog.close()}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
