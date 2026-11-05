import { NoHydration, ssr } from "solid-js/web"
import { Callout } from "./components/Callout"
import { Card } from "./components/Card"
import { CardGroup } from "./components/CardGroup"
import { CodeBlock } from "./components/CodeBlock"
import { CodeTabs } from "./components/CodeTabs"
import { OpenApiReference } from "./components/OpenApiReference"
import { PlanTabs } from "./components/PlanTabs"
import { Slot } from "./components/Slot"
import type { DocsModule } from "./content"
import { DocsLayout, type DocsAssets } from "./layouts/DocsLayout"

/** A docs page to render: a content page and its module, or the API reference (no module). */
export type DocsRender = { slug: string; module?: DocsModule; assets: DocsAssets }

const components = { Callout, Card, CardGroup, CodeBlock, CodeTabs, PlanTabs, Slot }

/**
 * A whole docs page: plain HTML with the docs' own stylesheet and script, and no hydration
 * (NoHydration), so it ships no framework code and none of the site's styles or scripts.
 */
export function DocsDocument(props: DocsRender) {
  const module = props.module
  return (
    <NoHydration>
      {ssr("<!DOCTYPE html>") as unknown as Element}
      {module ? (
        <DocsLayout
          title={module.frontmatter.title}
          description={module.frontmatter.description}
          currentSlug={props.slug}
          headings={module.headings}
          showTableOfContents={module.frontmatter.tableOfContents !== false}
          noindex={module.frontmatter.noindex}
          assets={props.assets}
        >
          <module.default components={components} />
        </DocsLayout>
      ) : (
        <DocsLayout
          title="API"
          description="OpenCode HTTP API reference and OpenAPI specification."
          currentSlug="api"
          headings={[]}
          showTableOfContents={false}
          fullWidth
          assets={props.assets}
        >
          <OpenApiReference />
        </DocsLayout>
      )}
    </NoHydration>
  )
}
