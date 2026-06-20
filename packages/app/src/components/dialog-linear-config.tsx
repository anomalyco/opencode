import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

type SyncMode = "manual" | "auto-push" | "auto-pull" | "bidirectional"

const SYNC_MODES: { value: SyncMode; labelKey: string }[] = [
  { value: "manual", labelKey: "dialog.linear.syncMode.manual" },
  { value: "auto-push", labelKey: "dialog.linear.syncMode.autoPush" },
  { value: "auto-pull", labelKey: "dialog.linear.syncMode.autoPull" },
  { value: "bidirectional", labelKey: "dialog.linear.syncMode.bidirectional" },
]

export function DialogLinearConfig(props: { onClose: () => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const linearMcpStatus = createMemo(() => {
    const mcp = sync.data.mcp["linear"]
    return mcp?.status === "connected"
  })

  const currentConfig = createMemo(() => sync.data.config.linear ?? {})

  const [store, setStore] = createStore({
    projectId: currentConfig().projectId ?? "",
    teamId: currentConfig().teamId ?? "",
    syncMode: (currentConfig().syncMode ?? "manual") as SyncMode,
    autoPush: currentConfig().autoPush ?? false,
  })

  const canSave = createMemo(() => {
    if (!linearMcpStatus()) return false
    if (!store.projectId.trim()) return false
    if (!store.teamId.trim()) return false
    return true
  })

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const config = {
        ...sync.data.config,
        linear: {
          projectId: store.projectId.trim(),
          teamId: store.teamId.trim(),
          syncMode: store.syncMode,
          autoPush: store.autoPush,
        },
      }
      await sdk.client.config.update({ config })
      dialog.close()
      props.onClose()
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (saveMutation.isPending || !canSave()) return
    saveMutation.mutate()
  }

  function handleOpenMcpConfig() {
    dialog.close()
    import("./dialog-select-mcp").then((mod) => {
      dialog.show(() => <mod.DialogSelectMcp />)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.linear.title")}
      description={language.t("dialog.linear.description")}
      class="w-full max-w-[480px] mx-auto"
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-4">
          {/* MCP Connection Status */}
          <div class="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-raised-base border border-border-base">
            <div class="flex items-center gap-2">
              <div
                class="size-2 rounded-full"
                classList={{
                  "bg-surface-success-base": linearMcpStatus(),
                  "bg-surface-warning-base": !linearMcpStatus(),
                }}
              />
              <span class="text-13-medium text-text-base">
                {linearMcpStatus()
                  ? language.t("dialog.linear.status.connected")
                  : language.t("dialog.linear.status.notConnected")}
              </span>
            </div>
            <Show when={!linearMcpStatus()}>
              <Button type="button" variant="ghost" size="small" onClick={handleOpenMcpConfig}>
                {language.t("dialog.linear.status.connectButton")}
              </Button>
            </Show>
          </div>

          {/* Project Select */}
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("dialog.linear.project.label")}</label>
            <Select
              options={[""]}
              current={store.projectId || undefined}
              placeholder={
                linearMcpStatus()
                  ? language.t("dialog.linear.project.placeholder")
                  : language.t("dialog.linear.project.disabled")
              }
              disabled={!linearMcpStatus()}
              value={(x) => x}
              label={(x) => x || language.t("dialog.linear.project.placeholder")}
              onSelect={(v) => setStore("projectId", v ?? "")}
              class="w-full"
            />
          </div>

          {/* Team Select */}
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("dialog.linear.team.label")}</label>
            <Select
              options={[""]}
              current={store.teamId || undefined}
              placeholder={
                linearMcpStatus()
                  ? language.t("dialog.linear.team.placeholder")
                  : language.t("dialog.linear.team.disabled")
              }
              disabled={!linearMcpStatus()}
              value={(x) => x}
              label={(x) => x || language.t("dialog.linear.team.placeholder")}
              onSelect={(v) => setStore("teamId", v ?? "")}
              class="w-full"
            />
          </div>

          {/* Sync Mode Radio Group */}
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("dialog.linear.syncMode.label")}</label>
            <RadioGroup
              options={SYNC_MODES}
              current={SYNC_MODES.find((m) => m.value === store.syncMode)}
              value={(x) => x.value}
              label={(x) => language.t(x.labelKey)}
              onSelect={(v) => setStore("syncMode", v?.value ?? "manual")}
              disabled={!linearMcpStatus()}
              class="w-full"
            />
          </div>

          {/* Auto-push Toggle */}
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-13-medium text-text-base">{language.t("dialog.linear.autoPush.label")}</span>
              <span class="text-12-regular text-text-weak">
                {language.t("dialog.linear.autoPush.description")}
              </span>
            </div>
            <Switch
              checked={store.autoPush}
              disabled={!linearMcpStatus() || store.syncMode === "manual"}
              onChange={(v) => setStore("autoPush", v)}
            />
          </div>

          {/* Help Text */}
          <p class="text-12-regular text-text-weaker">{language.t("dialog.linear.help")}</p>
        </div>

        {/* Action Buttons */}
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="large"
            disabled={saveMutation.isPending || !canSave()}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
