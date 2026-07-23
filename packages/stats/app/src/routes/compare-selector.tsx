import { createEffect, createMemo, createSignal, For } from "solid-js"
import { comparisonHref, modelRefFromCatalog } from "./compare-cards"
import type { ModelCatalogEntry } from "./model-catalog"

export function ComparisonSelector(props: {
  models: ModelCatalogEntry[]
  firstId?: string
  secondId?: string
  label?: string
}) {
  const [firstId, setFirstId] = createSignal(props.firstId ?? props.models[0]?.id ?? "")
  const [secondId, setSecondId] = createSignal(differentModelId(props.models, firstId(), props.secondId))
  const modelById = createMemo(() => new Map(props.models.map((model) => [model.id, model])))
  const href = createMemo(() => {
    const first = modelById().get(firstId())
    const second = modelById().get(secondId())
    if (!first || !second || first.id === second.id) return undefined
    return comparisonHref(modelRefFromCatalog(first), modelRefFromCatalog(second))
  })

  createEffect(() => {
    if (firstId() && modelById().has(firstId())) return
    const next = props.firstId && modelById().has(props.firstId) ? props.firstId : props.models[0]?.id
    if (next) setFirstId(next)
  })

  createEffect(() => {
    if (secondId() && secondId() !== firstId() && modelById().has(secondId())) return
    setSecondId(differentModelId(props.models, firstId(), props.secondId))
  })

  return (
    <form
      data-component="comparison-selector"
      aria-label={props.label ?? "Model comparison selector"}
      onSubmit={(event) => {
        event.preventDefault()
        const url = href()
        if (!url || typeof window === "undefined") return
        window.location.href = url
      }}
    >
      <label>
        <span>First model</span>
        <select value={firstId()} onInput={(event) => setFirstId(event.currentTarget.value)} required>
          <option value="" disabled>
            Select model
          </option>
          <For each={props.models}>
            {(model) => (
              <option value={model.id}>
                {model.name} ({model.lab})
              </option>
            )}
          </For>
        </select>
      </label>
      <label>
        <span>Second model</span>
        <select value={secondId()} onInput={(event) => setSecondId(event.currentTarget.value)} required>
          <option value="" disabled>
            Select model
          </option>
          <For each={props.models}>
            {(model) => (
              <option value={model.id} disabled={model.id === firstId()}>
                {model.name} ({model.lab})
              </option>
            )}
          </For>
        </select>
      </label>
      <button type="submit" disabled={!href()}>
        Compare models
      </button>
    </form>
  )
}

function differentModelId(models: ModelCatalogEntry[], firstId: string, preferredId: string | undefined) {
  if (preferredId && preferredId !== firstId && models.some((model) => model.id === preferredId)) return preferredId
  return models.find((model) => model.id !== firstId)?.id ?? ""
}
