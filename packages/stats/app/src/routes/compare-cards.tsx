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
}) {
  return (
    <Show when={props.pairs.length > 0}>
      <section id="model-comparison" data-section="model-panel" data-variant={props.compact ? "compact" : undefined}>
        <p data-slot="section-title">
          <strong>{props.title ?? "Model Comparisons"}.</strong>{" "}
          <span>{props.description ?? "Compare usage, cost, limits, and features."}</span>
        </p>
        <div data-component="comparison-card-grid">
          <For each={props.pairs}>
            {(pair) => (
              <a data-component="comparison-card" href={comparisonHref(pair.first, pair.second)}>
                <span>{pair.detail}</span>
                <strong>
                  {pair.first.name} <em>vs</em> {pair.second.name}
                </strong>
                <p>
                  <b>{pair.first.labName ?? formatCatalogLabName(pair.first.lab)}</b>
                  <i />
                  <b>{pair.second.labName ?? formatCatalogLabName(pair.second.lab)}</b>
                </p>
                <Show when={pair.first.metric || pair.second.metric}>
                  <small>
                    {pair.first.metric ?? "Listed"} / {pair.second.metric ?? "Listed"}
                  </small>
                </Show>
              </a>
            )}
          </For>
        </div>
      </section>
    </Show>
  )
}

function modelKey(model: ComparisonModelRef) {
  return `${catalogSlug(model.lab)}/${catalogSlug(model.slug)}`
}
