import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Select } from "@opencode-ai/ui/select"
import { For, Show, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { getAvatarColors, type AvatarColorKey } from "@/context/layout"
import { Avatar } from "@opencode-ai/ui/avatar"
import type { BossPreset } from "@/context/global-sync/types"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const

const ROUTING_OPTIONS: Array<{ value: "sequential" | "parallel" | "fallback"; label: string }> = [
  { value: "sequential", label: "Sequential" },
  { value: "parallel", label: "Parallel" },
  { value: "fallback", label: "Fallback" },
]

type ProviderRow = BossPreset["providers"][number]

export function DialogBossPreset(props: { preset?: BossPreset }) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const providers = useProviders()

  const isEditing = !!props.preset

  const defaultProvider: ProviderRow = {
    providerId: "",
    modelId: "",
    routing: "sequential",
    priority: 0,
  }

  const [store, setStore] = createStore({
    name: props.preset?.name ?? "",
    icon: props.preset?.icon ?? "",
    color: (props.preset?.color as AvatarColorKey) ?? "purple",
    providers: (props.preset?.providers?.length ? [...props.preset.providers] : [{ ...defaultProvider }]) as ProviderRow[],
    settings: {
      spawnWorkers: props.preset?.settings?.spawnWorkers ?? false,
      maxWorkers: props.preset?.settings?.maxWorkers ?? 3,
      notifyOnComplete: props.preset?.settings?.notifyOnComplete ?? true,
    },
  })

  const connectedProviders = createMemo(() => providers.connected())

  const modelsForProvider = (providerId: string) => {
    if (!providerId) return []
    const provider = connectedProviders().find((p) => p.id === providerId)
    if (!provider?.models) return []
    return Object.entries(provider.models).map(([id, model]) => ({
      id,
      name: model.name ?? id,
    }))
  }

  function addProviderRow() {
    setStore("providers", store.providers.length, { ...defaultProvider })
  }

  function removeProviderRow(index: number) {
    setStore(
      "providers",
      produce((draft) => {
        draft.splice(index, 1)
      }),
    )
  }

  function updateProviderRow(index: number, field: keyof ProviderRow, value: string | number | undefined) {
    setStore("providers", index, field as never, value as never)
    if (field === "providerId") {
      setStore("providers", index, "modelId", "")
    }
  }

  function save() {
    if (!store.name.trim()) return

    const preset: BossPreset = {
      id: props.preset?.id ?? `boss-${Date.now().toString(36)}`,
      name: store.name.trim(),
      icon: store.icon || undefined,
      color: store.color,
      providers: store.providers.filter((p) => p.providerId && p.modelId),
      settings: { ...store.settings },
    }

    globalSync.preset.create(preset)
    dialog.close()
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    save()
  }

  return (
    <Dialog title={isEditing ? "Edit Boss Preset" : "New Boss Preset"} class="w-full max-w-[560px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <TextField
          autofocus
          type="text"
          label="Preset Name"
          placeholder="e.g. Full Stack Team"
          value={store.name}
          onChange={(v) => setStore("name", v)}
        />

        <div class="flex gap-4 items-start">
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">Icon</label>
            <TextField
              type="text"
              placeholder="emoji"
              value={store.icon}
              onChange={(v) => setStore("icon", v)}
              class="w-20 text-center"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">Color</label>
            <div class="flex gap-1.5">
              <For each={AVATAR_COLOR_KEYS}>
                {(color) => (
                  <button
                    type="button"
                    aria-label={`Select ${color}`}
                    aria-pressed={store.color === color}
                    classList={{
                      "flex items-center justify-center size-8 p-0.5 rounded-lg overflow-hidden transition-colors cursor-default":
                        true,
                      "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover":
                        store.color === color,
                      "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
                        store.color !== color,
                    }}
                    onClick={() => setStore("color", color)}
                  >
                    <Avatar
                      fallback={store.icon || store.name || "B"}
                      {...getAvatarColors(color)}
                      class="size-full rounded"
                    />
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">Providers</label>
          <For each={store.providers}>
            {(row, index) => (
              <div class="flex items-start gap-2 p-3 rounded-lg bg-surface-base-hover border border-border-weak-base">
                <div class="flex-1 flex flex-col gap-2 min-w-0">
                  <Select
                    placeholder="Provider"
                    options={connectedProviders()}
                    value={(p) => p.id}
                    label={(p) => p.name ?? p.id}
                    current={connectedProviders().find((p) => p.id === row.providerId)}
                    onSelect={(val) => {
                      if (val) updateProviderRow(index(), "providerId", val.id)
                    }}
                  />
                  <Show when={row.providerId}>
                    <Select
                      placeholder="Model"
                      options={modelsForProvider(row.providerId)}
                      value={(m) => m.id}
                      label={(m) => m.name}
                      current={modelsForProvider(row.providerId).find((m) => m.id === row.modelId)}
                      onSelect={(val) => {
                        if (val) updateProviderRow(index(), "modelId", val.id)
                      }}
                    />
                  </Show>
                  <div class="flex gap-2">
                    <div class="flex-1">
                      <Select
                        placeholder="Routing"
                        options={ROUTING_OPTIONS}
                        value={(r) => r.value}
                        label={(r) => r.label}
                        current={ROUTING_OPTIONS.find((r) => r.value === (row.routing ?? "sequential"))}
                        onSelect={(val) => {
                          if (val) updateProviderRow(index(), "routing", val.value)
                        }}
                      />
                    </div>
                    <TextField
                      type="number"
                      label="Priority"
                      value={row.priority?.toString() ?? "0"}
                      onChange={(v) => updateProviderRow(index(), "priority", parseInt(v, 10) || 0)}
                      class="w-20"
                    />
                  </div>
                </div>
                <IconButton
                  icon="trash"
                  variant="ghost"
                  size="small"
                  aria-label="Remove provider"
                  onClick={() => removeProviderRow(index())}
                  disabled={store.providers.length <= 1}
                />
              </div>
            )}
          </For>
          <Button type="button" variant="ghost" size="small" onClick={addProviderRow}>
            <span class="mr-1">＋</span>
            Add Provider
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">Settings</label>
          <div class="flex flex-col gap-2 p-3 rounded-lg bg-surface-base-hover border border-border-weak-base">
            <label class="flex items-center gap-2 text-14-regular text-text-base cursor-pointer">
              <input
                type="checkbox"
                checked={store.settings.spawnWorkers}
                onChange={(e) => setStore("settings", "spawnWorkers", e.currentTarget.checked)}
                class="accent-text-interactive-base"
              />
              Spawn Workers
            </label>
            <label class="flex items-center gap-2 text-14-regular text-text-base cursor-pointer">
              <input
                type="checkbox"
                checked={store.settings.notifyOnComplete}
                onChange={(e) => setStore("settings", "notifyOnComplete", e.currentTarget.checked)}
                class="accent-text-interactive-base"
              />
              Notify on Complete
            </label>
            <Show when={store.settings.spawnWorkers}>
              <div class="flex items-center gap-3">
                <span class="text-14-regular text-text-base whitespace-nowrap">Max Workers</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={store.settings.maxWorkers ?? 3}
                  onInput={(e) => setStore("settings", "maxWorkers", parseInt(e.currentTarget.value, 10))}
                  class="flex-1 accent-text-interactive-base"
                />
                <span class="text-14-medium text-text-strong w-6 text-center">{store.settings.maxWorkers ?? 3}</span>
              </div>
            </Show>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={!store.name.trim()}>
            {isEditing ? language.t("common.save") : "Create Preset"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
