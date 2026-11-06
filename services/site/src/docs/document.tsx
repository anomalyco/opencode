import { NoHydration, ssr } from "solid-js/web"
import { CodeFrame } from "~/component/site/code-frame"
import { FileTree } from "~/component/site/file-type-icon"
import { HeadingLink } from "~/component/site/on-this-page"
import { I18nContext } from "~/context/i18n-context"
import { dict } from "~/i18n/en"
import { Callout } from "./components/Callout"
import { Card } from "./components/Card"
import { CardGroup } from "./components/CardGroup"
import { CodeBlock } from "./components/CodeBlock"
import { CodeTabs } from "./components/CodeTabs"
import { OpenApiReference } from "./components/OpenApiReference"
import { PlanTabs } from "./components/PlanTabs"
import { Slot } from "./components/Slot"
import { docsFiles, type DocsModule } from "./content"
import { DocsLayout, type DocsAssets } from "./layouts/DocsLayout"
import { docsMarkdownHref } from "./lib/navigation"

/** A docs page to render: a content page and its module, or the API reference (no module). */
export type DocsRender = { slug: string; module?: DocsModule; assets: DocsAssets }

// CodeFrame, FileTree and HeadingLink are what rehype-shiki.ts and rehype-headings.ts put in the tree.
const components = { Callout, Card, CardGroup, CodeBlock, CodeFrame, CodeTabs, FileTree, HeadingLink, PlanTabs, Slot }

// The site's components read their copy from the I18n context. The docs are English, so the English
// strings with their {{params}} filled in (as ~/i18n's interpolate), without the site's language loader.
const english = {
  t: (key: keyof typeof dict, params?: Record<string, string | number>) =>
    dict[key].replace(/\{\{(\w+)\}\}/g, (raw, name: string) => String(params?.[name] ?? raw)),
  translated: () => true,
}

/**
 * A whole docs page in the site's shell: plain HTML with the docs' own stylesheet and script, and no
 * hydration (NoHydration), so it ships no framework code. The site's components render here on the
 * server only; client.ts drives what they do in the browser.
 */
export function DocsDocument(props: DocsRender) {
  const module = props.module
  return (
    <NoHydration>
      {ssr("<!DOCTYPE html>") as unknown as Element}
      <I18nContext.Provider value={english}>
        {module ? (
          <DocsLayout
            title={module.frontmatter.title}
            description={module.frontmatter.description}
            currentSlug={props.slug}
            headings={module.frontmatter.tableOfContents === false ? [] : module.headings}
            noindex={module.frontmatter.noindex}
            assets={props.assets}
            source={docsFiles.get(props.slug)}
            markdown={docsMarkdownHref(props.slug)}
          >
            <module.default components={components} />
          </DocsLayout>
        ) : (
          <OpenApiReference assets={props.assets} />
        )}
      </I18nContext.Provider>
    </NoHydration>
  )
}
