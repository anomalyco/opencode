import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { For, Show } from "solid-js"
import { catalogSlug, formatCatalogLabName, type ModelCatalogEntry } from "./model-catalog"

export type ComparisonModelRef = {
  name: string
  lab: string
  slug: string
  labName?: string
  metric?: string
}

export type ComparisonPair = {
  first: ComparisonModelRef
  second: ComparisonModelRef
  detail: string
  description?: string
}

export function modelRefFromCatalog(entry: ModelCatalogEntry): ComparisonModelRef {
  return {
    name: entry.name,
    lab: entry.lab,
    slug: entry.slug,
    labName: formatCatalogLabName(entry.lab),
  }
}

export function comparisonHref(first: ComparisonModelRef, second: ComparisonModelRef) {
  return `${import.meta.env.BASE_URL}compare/${catalogSlug(first.lab)}/${catalogSlug(first.slug)}/${catalogSlug(
    second.lab,
  )}/${catalogSlug(second.slug)}`
}

export function uniqueComparisonPairs(pairs: ComparisonPair[]) {
  return pairs.reduce<{ keys: Set<string>; pairs: ComparisonPair[] }>(
    (result, pair) => {
      const key = [modelKey(pair.first), modelKey(pair.second)].toSorted().join("|")
      if (result.keys.has(key) || modelKey(pair.first) === modelKey(pair.second)) return result
      result.keys.add(key)
      result.pairs.push(pair)
      return result
    },
    { keys: new Set(), pairs: [] },
  ).pairs
}

export function ComparisonCardsSection(props: {
  pairs: ComparisonPair[]
  title?: string
  description?: string
  compact?: boolean
  variant?: "panel" | "featured"
}) {
  const featured = () => props.variant === "featured"
  const pairs = () => (featured() ? props.pairs.slice(0, 4) : props.pairs)

  return (
    <Show when={props.pairs.length > 0}>
      <section
        id="model-comparison"
        data-section={featured() ? "compare-home-related" : "model-panel"}
        data-variant={!featured() && props.compact ? "compact" : undefined}
      >
        <p data-slot="section-title">
          <strong>{props.title ?? "Model Comparisons"}.</strong>{" "}
          <span>{props.description ?? "Compare usage, cost, limits, and features."}</span>
        </p>
        <div data-component={featured() ? "compare-home-card-grid" : "comparison-card-grid"}>
          <For each={pairs()}>
            {(pair) => (featured() ? <FeaturedComparisonCard pair={pair} /> : <ComparisonPanelCard pair={pair} />)}
          </For>
        </div>
      </section>
    </Show>
  )
}

function FeaturedComparisonCard(props: { pair: ComparisonPair }) {
  return (
    <a
      data-component="compare-home-card"
      href={comparisonHref(props.pair.first, props.pair.second)}
      aria-label={`${props.pair.detail}: ${props.pair.first.name} vs ${props.pair.second.name}`}
    >
      <span data-slot="compare-home-card-head">
        <span>
          <strong>{props.pair.detail}</strong>
          <em>{props.pair.description ?? `${props.pair.first.name} vs ${props.pair.second.name}`}</em>
        </span>
        <b aria-hidden="true" />
      </span>
      <span data-slot="compare-home-card-divider" aria-hidden="true" />
      <span data-slot="compare-home-card-models">
        <span>{props.pair.first.name}</span>
        <i aria-hidden="true">·</i>
        <span>{props.pair.second.name}</span>
      </span>
      <span data-slot="compare-home-card-avatars" aria-hidden="true">
        <ComparisonLabLogo model={props.pair.first} />
        <ComparisonLabLogo model={props.pair.second} />
      </span>
    </a>
  )
}

function ComparisonPanelCard(props: { pair: ComparisonPair }) {
  return (
    <a data-component="comparison-card" href={comparisonHref(props.pair.first, props.pair.second)}>
      <span>{props.pair.detail}</span>
      <strong>
        {props.pair.first.name} <em>vs</em> {props.pair.second.name}
      </strong>
      <p>
        <b>{props.pair.first.labName ?? formatCatalogLabName(props.pair.first.lab)}</b>
        <i />
        <b>{props.pair.second.labName ?? formatCatalogLabName(props.pair.second.lab)}</b>
      </p>
      <Show when={props.pair.first.metric || props.pair.second.metric}>
        <small>
          {props.pair.first.metric ?? "Listed"} / {props.pair.second.metric ?? "Listed"}
        </small>
      </Show>
    </a>
  )
}

function ComparisonLabLogo(props: { model: ComparisonModelRef }) {
  const iconId = () => providerIconId(props.model.lab)

  return (
    <span
      data-slot="compare-home-avatar"
      data-lab={iconId()}
      data-size="small"
      aria-label={props.model.labName ?? formatCatalogLabName(props.model.lab)}
    >
      <ProviderIcon aria-hidden="true" id={iconId()} />
    </span>
  )
}

function modelKey(model: ComparisonModelRef) {
  return `${catalogSlug(model.lab)}/${catalogSlug(model.slug)}`
}

function providerIconId(provider: string) {
  const id = provider.toLowerCase().replace(/[^a-z0-9]+/g, "")
  if (id === "moonshot") return "moonshotai"
  if (id === "zhipu") return "zhipuai"
  return id
}
