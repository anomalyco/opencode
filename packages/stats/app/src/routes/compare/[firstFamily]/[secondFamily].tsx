import { Meta, Title } from "@solidjs/meta"
import { createAsync, useParams } from "@solidjs/router"
import { createMemo, Show } from "solid-js"
import ModelCompareDetailPage from "../../../component/model-compare-detail"
import { resolveComparisonFamily } from "../../../lib/comparison-pages"
import { getModelCatalog } from "../../model-catalog"

export default function ModelCompareFamily() {
  const params = useParams()
  const catalog = createAsync(() => getModelCatalog())
  const comparison = createMemo(() => {
    const source = catalog()
    if (!source) return undefined
    const first = resolveComparisonFamily(source, params.firstFamily ?? "")
    const second = resolveComparisonFamily(source, params.secondFamily ?? "")
    if (!first || !second || first.slug === second.slug) return null
    return { first, second }
  })

  return (
    <Show
      when={comparison()}
      fallback={
        <Show when={comparison() === null}>
          <Title>Model comparison not found</Title>
          <Meta name="robots" content="noindex,follow" />
          <main data-page="stats">
            <div data-component="empty-state">
              <strong>Comparison not found</strong>
              <p>Choose two model families to compare.</p>
              <a href={`${import.meta.env.BASE_URL}compare`}>Compare models</a>
            </div>
          </main>
        </Show>
      }
    >
      {(resolved) => (
        <ModelCompareDetailPage
          first={{ lab: resolved().first.model.lab, slug: resolved().first.model.slug }}
          second={{ lab: resolved().second.model.lab, slug: resolved().second.model.slug }}
          family={resolved()}
          catalog={catalog()}
        />
      )}
    </Show>
  )
}
