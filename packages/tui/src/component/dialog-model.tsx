import { createMemo, createSignal, Show } from "solid-js"
import { RGBA } from "@opentui/core"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

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
            titleSuffix: priceTierView(model.cost),
            description: provider.name,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: modelPriceFooter(provider.id, model.cost),
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
            titleSuffix: priceTierView(info.cost),
            releaseDate: info.release_date,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "opencode" && model.includes("-nano"),
            footer: modelPriceFooter(provider.id, info.cost),
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
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
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
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

// Costs are stored as USD per 1M tokens. Trim to at most 2 decimals so prices
// read as "$1.4" / "$5" / "$0.27" rather than "$1.40" / "$5.00".
function formatModelPrice(value: number): string {
  return `$${Math.round(value * 100) / 100}`
}

// Right-aligned price column shown on each picker row: "$<input> / $<output>"
// per 1M tokens. opencode's free models keep their "Free" label, and models
// without a positive input price show no footer.
export function modelPriceFooter(
  providerID: string,
  cost: { input?: number; output?: number } | undefined,
): string | undefined {
  const input = cost?.input ?? 0
  if (input === 0) return providerID === "opencode" ? "Free" : undefined
  return `${formatModelPrice(input)} / ${formatModelPrice(cost?.output ?? 0)}`
}

// A coarse 1-4 price tier shown as a "$$·" indicator after the model name.
// The calculation is based on the average of the input and output costs,
// with the input cost weighted double, as it's the more significant factor for most use cases.
// The tiers are defined as follows:
// Tiers (USD per 1M tokens): x<=1 -> 1, 1<x<=10 -> 2, 10<x<17 -> 3, x>=17 -> 4.
export function modelPriceTier(cost: { input?: number; output?: number } | undefined): number | undefined {
  const input = cost?.input ?? 0
  const output = cost?.output ?? 0
  if (input === 0 && output === 0) return undefined
  const x = (2 * input + output) / 2
  if (x <= 1) return 1
  if (x <= 10) return 2
  if (x < 17) return 3
  return 4
}

// Renders the tier as filled "$" (colored green->yellow->orange->red by tier)
// plus dimmed "·" placeholders up to 3, with a trailing "+" for the top tier.
function PriceTier(props: { tier: number }) {
  const { theme } = useTheme()
  const color = createMemo(() => {
    switch (props.tier) {
      case 1:
        return theme.success
      case 2:
        return theme.warning
      case 3:
        return RGBA.fromValues(
          (theme.warning.r + theme.error.r) / 2,
          (theme.warning.g + theme.error.g) / 2,
          (theme.warning.b + theme.error.b) / 2,
          1,
        )
      default:
        return theme.error
    }
  })
  const filled = "$".repeat(Math.min(props.tier, 3))
  const dots = "·".repeat(Math.max(0, 3 - props.tier))
  return (
    <>
      <span style={{ fg: color() }}> {filled}</span>
      <Show when={dots}>
        <span style={{ fg: theme.textMuted }}>{dots}</span>
      </Show>
      <Show when={props.tier >= 4}>
        <span style={{ fg: color() }}>+</span>
      </Show>
    </>
  )
}

function priceTierView(cost: { input?: number; output?: number } | undefined) {
  const tier = modelPriceTier(cost)
  return tier ? <PriceTier tier={tier} /> : undefined
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    (option) => option.title,
  )
}
