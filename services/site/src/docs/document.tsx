import type { ComponentProps, JSX } from "solid-js"
import { NoHydration, ssr } from "solid-js/web"
import { CodeFrame } from "~/component/site/code-frame"
import { FileTree } from "~/component/site/file-type-icon"
import { HeadingLink } from "~/component/site/on-this-page"
import { useI18n } from "~/context/i18n"
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
import { Tabs } from "./components/Tabs"
import type { DocsSet } from "./config"
import { docsFiles, type DocsModule } from "./content"
import { DocsLayout, type DocsAssets, type DocsV1, type DocsVersions } from "./layouts/DocsLayout"
import { docsMarkdownHref } from "./lib/navigation"
import type { V1Locale } from "./lib/v1-navigation"

/**
 * A docs page to render: a set's content page and its module, or the API reference (no module), with
 * the page in each docs version and, on the V1 docs, its language's section and languages.
 */
export type DocsRender = {
  set: DocsSet
  slug: string
  module?: DocsModule
  assets: DocsAssets
  versions?: DocsVersions
  v1?: DocsV1
}

// rehype-shiki.ts leaves the labels of terminals, file trees and diffs to the page's language.
function DocsCodeFrame(props: ComponentProps<typeof CodeFrame>) {
  const i18n = useI18n()
  const label =
    props.kind === "terminal"
      ? "docs.code.terminal"
      : props.kind === "tree"
        ? "docs.code.files"
        : props.variant === "codeDiff"
          ? "docs.code.diff"
          : undefined
  return <CodeFrame {...props} label={props.label ?? (label && i18n.t(label))} />
}

// CodeFrame, FileTree and HeadingLink are what rehype-shiki.ts and rehype-headings.ts put in the tree.
const components = {
  Callout,
  Card,
  CardGroup,
  CodeBlock,
  CodeFrame: DocsCodeFrame,
  CodeTabs,
  FileTree,
  HeadingLink,
  PlanTabs,
  Slot,
  Tabs,
}

// The site's components and the docs' own read their copy from the I18n context: the page's
// language's strings (the latest docs are English; the V1 docs have the site's languages and
// Bosnian, src/i18n/bs.ts) with their {{params}} filled in (as ~/i18n's interpolate), without the
// site's language loader.
const dicts = import.meta.glob<typeof dict>("../i18n/{ar,br,bs,da,de,es,fr,it,ja,ko,no,pl,ru,th,tr,zh,zht}.ts", {
  eager: true,
  import: "dict",
})
export const docsI18n = (locale?: V1Locale) => {
  const table = dicts[`../i18n/${locale?.site ?? locale?.path}.ts`] ?? dict
  return {
    t: (key: keyof typeof dict, params?: Record<string, string | number>) =>
      table[key].replace(/\{\{(\w+)\}\}/g, (raw, name: string) => String(params?.[name] ?? raw)),
    translated: () => true,
  }
}

// A Markdown link on a V1 page, with its anchor where it is on the page it goes to.
const link = (anchor: (href: string) => string) => (props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a {...props} href={anchor(props.href ?? "")} />
)

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
      <I18nContext.Provider value={docsI18n(props.v1?.locale)}>
        {module ? (
          <DocsLayout
            set={props.set}
            title={module.frontmatter.title}
            description={module.frontmatter.description}
            currentSlug={props.slug}
            headings={module.frontmatter.tableOfContents === false ? [] : module.headings}
            noindex={module.frontmatter.noindex}
            assets={props.assets}
            source={docsFiles.get(props.set.id)?.get(props.slug)}
            markdown={docsMarkdownHref(props.slug, props.set)}
            versions={props.versions}
            v1={props.v1}
          >
            <module.default components={props.v1 ? { ...components, a: link(props.v1.anchor) } : components} />
          </DocsLayout>
        ) : (
          <OpenApiReference assets={props.assets} />
        )}
      </I18nContext.Provider>
    </NoHydration>
  )
}
