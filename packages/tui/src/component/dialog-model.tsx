import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import { DialogModelCtx } from "./dialog-model-ctx"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useToast } from "../ui/toast"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useProject } from "../context/project"
import { createClient, createConfig } from "../local/llama-skein/gen/client"
import { LlamaSkeinClient } from "../local/llama-skein/gen/sdk.gen"
import { extractMem, fmtGB, normalizeBaseURL } from "../local/model-fit"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const project = useProject()
  const dialog = useDialog()
  const toast = useToast()
  const [query, setQuery] = createSignal("")
  const [settingDefault, setSettingDefault] = createSignal(false)

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  // Total VRAM (or unified memory) per local provider, fetched once per dialog
  // lifetime — never blocks dialog open, and a provider that doesn't answer
  // /api/hardware (non-local, or an older backend) simply has no label.
  const [vram, setVram] = createSignal<Record<string, string>>({})

  onMount(() => {
    void sync.refreshProviders().catch(() => undefined)
    for (const item of sync.data.provider) {
      const baseURL = item.options?.["baseURL"] as string | undefined
      if (!baseURL) continue
      const llamaClient = new LlamaSkeinClient({
        client: createClient(createConfig({ baseUrl: normalizeBaseURL(baseURL) })),
      })
      llamaClient
        .getHardware()
        .then((res) => {
          if (!res.data) return
          const mem = extractMem(res.data)
          if (!mem || mem.totalMb <= 0) return
          setVram((prev) => ({ ...prev, [item.id]: `${fmtGB(mem.totalMb)} GB ${mem.label}` }))
        })
        .catch(() => {
          // backend may not support /api/hardware — no VRAM label, nothing else changes
        })
    }
  })

  function providerLabel(providerID: string, name: string) {
    const label = vram()[providerID]
    return label ? `${name} · ${label}` : name
  }

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((provider) => provider.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            provenance: providerLabel(provider.id, provider.name),
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            // sizeBytes rides on the runtime provider Model (llama-skein
            // size_bytes) but isn't in the generated SDK type yet — read it
            // loosely; regen the SDK to type it properly.
            footer:
              formatModelSize((model as { sizeBytes?: number }).sizeBytes) ??
              (model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined),
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            releaseDate: info.release_date,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? providerLabel(provider.id, provider.name) : undefined,
            provenance: providerLabel(provider.id, provider.name),
            disabled: provider.id === "opencode" && model.includes("-nano"),
            footer:
              formatModelSize((info as { sizeBytes?: number }).sizeBytes) ??
              (info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined),
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((option) => {
            if (!showSections) return true
            if (
              favorites.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            if (
              recents.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            return true
          }),
          (options) => sortModelOptions(options, props.providerID !== undefined),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...sortModelOptions(
          fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
          false,
        ),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
        {
          command: "model.dialog.ctx",
          title: "Set context size",
          disabled: !connected(),
          onTrigger: (option) => {
            const { providerID, modelID } = option.value as { providerID: string; modelID: string }
            const provider = sync.data.provider.find((p) => p.id === providerID)
            if (!provider?.options?.baseURL) {
              toast.show({ variant: "warning", message: "Context size is only available for local providers" })
              return
            }
            dialog.replace(() => <DialogModelCtx providerID={providerID} modelID={modelID} />)
          },
        },
        {
          command: "model.dialog.default",
          title: "Set as default",
          hidden: !connected(),
          disabled: settingDefault(),
          onTrigger: async (option) => {
            const { providerID, modelID } = option.value as { providerID: string; modelID: string }
            setSettingDefault(true)
            try {
              const workspace = project.workspace.current()
              await sdk.client.config.update(
                { workspace, config: { model: `${providerID}/${modelID}` } },
                { throwOnError: true },
              )
              const refreshed = await sdk.client.config.get({ workspace }, { throwOnError: true })
              sync.set("config", refreshed.data!)
              toast.show({ variant: "success", message: "Default model updated" })
            } catch {
              toast.show({ variant: "warning", message: "Failed to set default model" })
            } finally {
              setSettingDefault(false)
            }
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

// formatModelSize renders a llama-skein size_bytes weight size as a compact
// GB/MB string for the picker footer, so similar quantizations are told apart
// by disk size. undefined when unknown (non-local models, size not reported).
export function formatModelSize(bytes?: number): string | undefined {
  if (!bytes || bytes <= 0) return undefined
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}
