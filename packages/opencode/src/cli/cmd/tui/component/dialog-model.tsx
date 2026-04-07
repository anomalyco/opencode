import { createMemo, createResource, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import { useKeybind } from "../context/keybind"
import * as fuzzysort from "fuzzysort"
import { consoleManagedProviderLabel } from "@tui/util/provider-origin"
import { Auth } from "@/auth"

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()
  const [auth] = createResource(async () => Auth.all())

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    const keyOf = (item: { providerID: string; modelID: string; authProfile?: string }) =>
      `${item.providerID}/${item.modelID}/${item.authProfile ?? "default"}`

    const profileMap = createMemo(() => {
      const out = new Map<string, Set<string | undefined>>()
      const ensure = (providerID: string) => {
        if (!out.has(providerID)) out.set(providerID, new Set([undefined]))
        return out.get(providerID)!
      }

      for (const provider of sync.data.provider) ensure(provider.id)

      const data = auth() ?? {}
      for (const key of Object.keys(data)) {
        const idx = key.lastIndexOf(":")
        const providerID = idx === -1 ? key : key.slice(0, idx)
        const profile = idx === -1 ? undefined : key.slice(idx + 1)
        ensure(providerID).add(profile)
      }

      for (const item of local.model.recent()) {
        ensure(item.providerID).add(item.authProfile)
      }

      for (const item of local.model.favorite()) {
        ensure(item.providerID).add((item as { authProfile?: string }).authProfile)
      }

      const current = local.model.current()
      if (current) ensure(current.providerID).add(current.authProfile)

      for (const item of sync.data.agent) {
        const model = item.model as { providerID?: string; authProfile?: string } | undefined
        if (!model?.providerID) continue
        ensure(model.providerID).add(model.authProfile)
      }

      return out
    })

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id, authProfile: item.authProfile },
            title: model.name ?? item.modelID,
            description: `${consoleManagedProviderLabel(
              sync.data.console_state.consoleManagedProviders,
              provider.id,
              provider.name,
            )}${item.authProfile ? `:${item.authProfile}` : ":default"}`,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect: () => {
              onSelect(provider.id, model.id, item.authProfile)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter((item) => !favorites.some((fav) => keyOf(fav) === keyOf(item))),
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
          flatMap(([model, info]) => {
            const profiles = [...(profileMap().get(provider.id) ?? new Set([undefined]))]
            return profiles.map((authProfile) => {
              const value = { providerID: provider.id, modelID: model, authProfile }
              return {
                value,
                title: info.name ?? model,
                description: favorites.some((item) => keyOf(item) === keyOf(value)) ? "(Favorite)" : undefined,
                category: connected()
                  ? `${consoleManagedProviderLabel(sync.data.console_state.consoleManagedProviders, provider.id, provider.name)}${authProfile ? `:${authProfile}` : ""}`
                  : undefined,
                disabled: provider.id === "opencode" && model.includes("-nano"),
                footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
                onSelect() {
                  onSelect(provider.id, model, authProfile)
                },
              }
            })
          }),
          filter((x) => {
            if (!showSections) return true
            if (favorites.some((item) => keyOf(item) === keyOf(x.value))) return false
            if (recents.some((item) => keyOf(item) === keyOf(x.value))) return false
            return true
          }),
          sortBy(
            (x) => x.footer !== "Free",
            (x) => x.title,
          ),
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
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return consoleManagedProviderLabel(sync.data.console_state.consoleManagedProviders, value.id, value.name)
  })

  function onSelect(providerID: string, modelID: string, authProfile?: string) {
    local.model.set({ providerID, modelID, authProfile }, { recent: true })
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
      keybind={[
        {
          keybind: keybind.all.model_provider_list?.[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string; authProfile?: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current() as any}
    />
  )
}
