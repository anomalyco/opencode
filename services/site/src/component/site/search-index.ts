import { joinSentences } from "~/i18n/rich"
import { config } from "~/config"
import type { Translate } from "~/i18n"
import { localize } from "~/i18n/content"
import { extensionsSource } from "~/i18n/content/areas/extensions"
import { productDetailsSource } from "~/i18n/content/areas/product-details"
import { productsSource } from "~/i18n/content/areas/products"
import type { Locale } from "~/lib/language"
import { brandContent, brandMarkdown } from "~/lib/brand-content"
import { brandAssets } from "~/lib/media"
import type { ChangelogRelease } from "~/lib/changelog"
import { changelogTimeline } from "~/lib/changelog-notes"
import { docsConfigure, docsIntro, docsPages, docsProducts, docsToc } from "~/lib/docs-content"
import { downloadContent } from "~/lib/download-content"
import { fontContent } from "~/lib/font-content"
import { homeContent } from "~/lib/home-content"
import { markdownDocument, type RichText } from "~/lib/markdown"
import { pressContent } from "~/lib/press-content"
import { extensionPages } from "./extension-data"
import legalSearch from "./legal-search.json"
import { deviceOrder, productPages } from "./product-data"

// The ⌘K search's index and ranking, loaded with a dynamic import the first time the search opens.

export const searchGroups = ["Recent", "Pages", "Sections", "Docs", "Changelog", "Actions"] as const
export type SearchGroup = (typeof searchGroups)[number]

export type SearchAction = "theme" | "brand-rules" | "brand-assets" | "settings" | "design" | "device-preview"

export type SearchItem = {
  id: string
  group: SearchGroup
  title: string
  /** Where the item lives, shown beside it: the page, the document or the release. */
  context?: string
  /** More text to search, shown as a snippet when the query only matches here. */
  body?: string
  keywords?: string
  href?: string
  /** What to scroll to once the page is showing: an element ID, a heading's text, or a FAQ question. */
  target?: { id?: string; text?: string; faq?: string }
  action?: SearchAction
}

export type SearchResult = {
  item: SearchItem
  score: number
  /** Matched ranges in the title. */
  title: [number, number][]
  /** A part of the body around the match, with its matched ranges, when the title does not match. */
  snippet?: { text: string; ranges: [number, number][] }
}

export function buildSearchIndex(
  t: Translate,
  route: (path: string) => string,
  locale: Locale,
  dev: boolean,
): SearchItem[] {
  const home = homeContent(t, route)
  const download = localize(locale, "download", downloadContent(t, route))
  const press = localize(locale, "press", pressContent(t, route))
  const brand = localize(locale, "brand", brandContent(t))
  const content = {
    products: localize(locale, "products", productsSource),
    productDetails: localize(locale, "productDetails", productDetailsSource),
    extensions: localize(locale, "extensions", extensionsSource),
  }
  const names = {
    home: t("nav.home"),
    product: t("site.nav.product"),
    press: t("site.footer.press"),
    brand: t("legal.brand"),
  }
  const section = (page: string, path: string, title: string, body?: string, keywords?: string): SearchItem => ({
    id: `section:${path}:${title}`,
    group: "Sections",
    title,
    context: page,
    body,
    keywords,
    href: route(path),
    target: { text: title },
  })
  const faq = (page: string, path: string) =>
    home.faq.items.map(
      (item): SearchItem => ({
        id: `faq:${path}:${item.question}`,
        group: "Sections",
        title: item.question,
        context: t("site.search.faq", { page }),
        body: plainRich(item.answer),
        keywords: "faq question",
        href: route(path),
        target: { faq: item.question },
      }),
    )

  const pages: SearchItem[] = [
    { title: names.home, path: "/", body: joinSentences([home.hero.title, ...home.hero.subtitle]) },
    {
      title: names.product,
      path: "/product",
      body: t("site.search.productBody"),
      keywords: "apps download install",
    },
    ...deviceOrder(productPages).map((product) => ({
      title: content.products[product.slug].name,
      path: `/${product.slug}`,
      body: `${content.products[product.slug].body} ${content.productDetails[product.slug].intro}`,
      keywords: "product",
    })),
    ...extensionPages.map((extension) => ({
      title: content.extensions[extension.slug].name,
      path: `/extensions/${extension.slug}`,
      body: `${content.extensions[extension.slug].body} ${content.extensions[extension.slug].intro}`,
      keywords: "extension",
    })),
    { title: t("nav.changelog"), path: "/changelog", keywords: "releases versions what's new" },
    { title: names.brand, path: "/brand", body: brand.hero.body, keywords: "logo wordmark assets" },
    { title: names.press, path: "/press", body: press.hero.body, keywords: "press kit media" },
    { title: "Font", path: "/font", body: fontContent.description, keywords: "typeface type otf letters download" },
    { title: t("site.footer.legal"), path: "/legal" },
    ...legalSearch.map((document) => ({
      title: document.title,
      path: document.path,
      body: document.description,
      keywords: "legal",
    })),
  ].map(
    (page): SearchItem => ({
      id: `page:${page.path}`,
      group: "Pages",
      title: page.title,
      context: page.path,
      body: page.body,
      keywords: page.keywords,
      href: route(page.path),
    }),
  )
  const external: SearchItem[] = [
    { title: t("site.nav.console"), href: "/console", keywords: "models subscriptions zen go" },
    { title: t("site.nav.subscriptions"), href: "/console/go", keywords: "go go plus plans pricing subscribe" },
    { title: t("nav.enterprise"), href: "/console/enterprise", keywords: "sales business teams" },
    { title: "GitHub", href: config.github.repoUrl, keywords: "source repo code" },
  ].map((page) => ({ id: `page:${page.href}`, group: "Pages", context: page.href, ...page }))

  const homeSections = [
    section(names.home, "/", home.what.title, plainRich(home.what.lead)),
    ...home.what.features.map((feature) => section(names.home, "/", feature.title, feature.body)),
    section(
      names.home,
      "/",
      home.tools.title,
      plainRich(home.tools.lead),
      home.tools.items.map((i) => i.name).join(" "),
    ),
    section(names.home, "/", home.openSource.title, stripTags(home.openSource.lead)),
    section(names.home, "/", home.faq.title, undefined, "questions"),
    section(names.home, "/", home.console.title, `${home.console.headline} ${home.console.body}`),
  ]
  const productSections = productPages.flatMap((product) => [
    ...content.productDetails[product.slug].showcase.map((row) =>
      section(content.products[product.slug].name, `/${product.slug}`, row.title, row.body),
    ),
    ...content.productDetails[product.slug].features.map((feature) =>
      section(content.products[product.slug].name, `/${product.slug}`, feature.title, feature.body),
    ),
  ])
  // The download lists: each app's on its product page, the extensions and integrations on /product.
  const downloadSections = [
    section(
      content.products.desktop.name,
      "/desktop#download",
      t("download.action.download"),
      download.desktop.builds.map((b) => b.label).join(" "),
    ),
    section(
      content.products.mobile.name,
      "/mobile#download",
      t("download.action.download"),
      "iOS iPhone TestFlight beta Android Google Play",
    ),
    section(
      content.products.terminal.name,
      "/terminal#download",
      t("download.action.download"),
      download.terminal.installs.map((i) => i.command).join(" "),
    ),
    section(
      names.product,
      "/product#download",
      download.extensions.title,
      download.extensions.items.map((i) => i.label).join(" "),
    ),
    section(names.product, "/product#download", download.integrations.title, "GitHub GitLab"),
  ]
  const pressSections = [press.company, press.about, press.brand, press.product, press.contact].map((part) =>
    section(names.press, "/press", part.title, "lead" in part ? part.lead : undefined),
  )
  const brandSections = [
    ...brand.families.map((family) => section(names.brand, "/brand", family.title, family.body)),
    section(names.brand, "/brand", brand.variants.title),
    section(names.brand, "/brand", brand.colors.title, brand.colors.body, "hex palette"),
    section(names.brand, "/brand", brand.usage.title, brand.usage.body),
    section(names.brand, "/brand", brand.usage.clearSpace.title, brand.usage.clearSpace.body),
    section(names.brand, "/brand", brand.usage.pixels.title, brand.usage.pixels.body),
    section(
      names.brand,
      "/brand",
      brand.donts.title,
      brand.donts.body,
      brand.donts.examples.map((e) => e.caption).join(" "),
    ),
  ]
  const legalSections = legalSearch
    .flatMap((document) => document.headings)
    .map(
      (heading): SearchItem => ({
        id: `legal:${heading.path}#${heading.id}`,
        group: "Sections",
        title: heading.title,
        context: heading.document,
        body: heading.body,
        href: `${route(heading.path)}#${heading.id}`,
        target: { id: heading.id },
      }),
    )

  const docsPath = (href: string) => new URL(href, "https://opencode.ai").pathname
  // Only the docs Intro is a page of this site (routes/docs); the other docs pages are the live
  // v2 docs, served at the same paths on opencode.ai. Linking them absolutely makes them a full
  // page load there and a new tab from a preview or local build, where those paths don't exist.
  const liveDocs = (href: string) => (href === docsPages[0].href ? route(href) : `${config.baseUrl}${href}`)
  const docs: SearchItem[] = [
    ...docsToc.map((entry) => ({
      id: `docs:intro#${entry.id}`,
      group: "Docs" as const,
      title: entry.label,
      context: "Docs › Intro",
      body: docsBody(entry.id),
      href: `${route(docsPages[0].href)}#${entry.id}`,
      target: { id: entry.id },
    })),
    ...[...docsPages, ...docsConfigure].map((page) => ({
      id: `docs:${page.href}`,
      group: "Docs" as const,
      title: page.label,
      context: docsPath(page.href),
      body: page.label === "Intro" ? docsIntro.lead : undefined,
      href: liveDocs(page.href),
    })),
    ...docsProducts
      .filter((product) => product.label !== "Docs")
      .map((product) => ({
        id: `docs:${product.href}`,
        group: "Docs" as const,
        title: product.label === "V1" ? "V1 docs" : `${product.label} docs`,
        context: docsPath(product.href),
        keywords: product.label === "V1" ? "v1 legacy old docs" : undefined,
        href: product.href.startsWith("/") ? liveDocs(product.href) : product.href,
      })),
  ]

  const actions: SearchItem[] = [
    {
      id: "action:theme",
      group: "Actions",
      title: t("site.search.toggleTheme"),
      keywords: "dark light mode appearance",
      action: "theme",
    },
    {
      id: "action:brand-rules",
      group: "Actions",
      title: t("site.search.copyRules"),
      context: t("site.search.copyRulesContext"),
      keywords: "brand logo guidelines clipboard",
      action: "brand-rules",
    },
    {
      id: "action:brand-assets",
      group: "Actions",
      title: t("site.search.downloadAssets"),
      context: "ZIP",
      keywords: "brand logo wordmark zip press",
      href: brandAssets,
      action: "brand-assets",
    },
    // Development tools, which production doesn't have.
    ...(import.meta.env.DEV && dev
      ? ([
          { id: "action:settings", group: "Actions", title: "Open Settings", context: "⇧S", action: "settings" },
          { id: "action:design", group: "Actions", title: "Toggle Design mode", context: "⇧D", action: "design" },
          {
            id: "action:device-preview",
            group: "Actions",
            title: "Device preview",
            context: "⇧P",
            keywords: "responsive viewport phone tablet desktop mobile size breakpoint",
            action: "device-preview",
          },
        ] satisfies SearchItem[])
      : []),
  ]

  return [
    ...pages,
    ...external,
    ...homeSections,
    ...productSections,
    ...downloadSections,
    ...faq(names.home, "/"),
    ...pressSections,
    ...brandSections,
    ...legalSections,
    ...docs,
    ...actions,
  ]
}

/** The brand page as Markdown, as its "Copy rules for your agent" button copies it. */
export function brandRules(t: Translate, route: (path: string) => string) {
  return markdownDocument("/brand", brandMarkdown, { t, route })
}

/** Changelog entries and their versions, from the same JSON the changelog serves. */
export function changelogItems(releases: ChangelogRelease[], route: (path: string) => string): SearchItem[] {
  return changelogTimeline(releases).map((entry) => {
    const tags = entry.releases.map((release) => release.tag)
    return {
      id: `changelog:${tags[0]}`,
      group: "Changelog",
      title: entry.title,
      context: tags.join(", "),
      body: [entry.summary, ...entry.features.map((f) => f.title), ...entry.improved.map((n) => n.text)]
        .join(" ")
        .slice(0, 800),
      // "v1" finds every 1.x release; "1.4" finds v1.4.0.
      keywords: tags.flatMap((tag) => [tag, tag.replace(/^v/, ""), tag.split(".").slice(0, 2).join(".")]).join(" "),
      href: route(`/changelog/${tags[0]}`),
      target: { id: tags[0] },
    }
  })
}

/**
 * Ranks items for a query: every word must match the title, the keywords or the body, as a
 * substring or (in the title) as letters in order. Title matches at the start of a word rank
 * highest, then other title matches, keywords and the body.
 */
export function rank(items: SearchItem[], query: string): SearchResult[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return items
    .flatMap((item) => {
      const title = item.title.toLowerCase()
      const keywords = `${item.keywords ?? ""} ${item.context ?? ""}`.toLowerCase()
      const body = (item.body ?? "").toLowerCase()
      const matches = words.map((word) => {
        const at = title.indexOf(word)
        if (at >= 0) {
          const start = at === 0 ? 100 : /\W/.test(title[at - 1]) ? 80 : 50
          return {
            score: start + (word.length / title.length) * 20,
            title: [[at, at + word.length]] as [number, number][],
          }
        }
        if (keywords.includes(word)) return { score: 30, title: [] }
        const fuzzy = subsequence(title, word)
        if (fuzzy) return { score: 20 - fuzzy.spread, title: fuzzy.ranges }
        const inBody = body.indexOf(word)
        if (inBody >= 0) return { score: 10, title: [], body: inBody }
        return undefined
      })
      if (matches.some((match) => !match)) return []
      const found = matches.filter((match) => match !== undefined)
      const ranges = merge(found.flatMap((match) => match.title))
      const bodyAt = found.find((match) => "body" in match && match.body !== undefined)
      const snippet =
        ranges.length === 0 && bodyAt && "body" in bodyAt && bodyAt.body !== undefined
          ? snip(item.body ?? "", bodyAt.body, words)
          : undefined
      // Pages and actions edge ahead of sections with the same score.
      const weight = item.group === "Pages" ? 6 : item.group === "Actions" ? 4 : item.group === "Changelog" ? -2 : 0
      return [{ item, score: found.reduce((sum, match) => sum + match.score, 0) + weight, title: ranges, snippet }]
    })
    .sort((a, b) => b.score - a.score)
    .filter(
      // Legal documents repeat some headings (one per state); one row each is enough.
      (result, index, all) =>
        all.findIndex(
          (other) => other.item.title === result.item.title && other.item.context === result.item.context,
        ) === index,
    )
}

/** The word's letters in order in `text`, preferring runs; undefined when they are not all there. */
function subsequence(text: string, word: string) {
  if (word.length < 2) return undefined
  const indices = [...word].reduce<number[] | undefined>((acc, letter) => {
    if (!acc) return undefined
    const next = text.indexOf(letter, (acc.at(-1) ?? -1) + 1)
    return next < 0 ? undefined : [...acc, next]
  }, [])
  if (!indices) return undefined
  const spread = indices[indices.length - 1] - indices[0] - word.length + 1
  // Letters scattered across a long title are noise, not a match.
  if (spread > word.length * 3) return undefined
  return { spread, ranges: merge(indices.map((index): [number, number] => [index, index + 1])) }
}

function merge(ranges: [number, number][]) {
  return [...ranges]
    .sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((acc, range) => {
      const last = acc.at(-1)
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
      else acc.push([range[0], range[1]])
      return acc
    }, [])
}

function snip(body: string, at: number, words: string[]) {
  const start = Math.max(0, body.lastIndexOf(" ", Math.max(0, at - 32)) + 1)
  const text = `${start > 0 ? "…" : ""}${body.slice(start, start + 120).trim()}${body.length > start + 120 ? "…" : ""}`
  const lower = text.toLowerCase()
  const ranges = words.flatMap((word) => {
    const index = lower.indexOf(word)
    return index >= 0 ? [[index, index + word.length] as [number, number]] : []
  })
  return { text, ranges: merge(ranges) }
}

function plainRich(value: RichText) {
  return value.map((part) => (typeof part === "string" ? part : "text" in part ? part.text : part.code)).join("")
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, "")
}

function docsBody(id: string) {
  const bodies: Record<string, string> = {
    cli: docsIntro.cli.map(plainRich).join(" "),
    desktop: docsIntro.desktop,
    web: plainRich(docsIntro.web.lead),
    docker: plainRich(docsIntro.docker),
    connect: docsIntro.connect.map(plainRich).join(" "),
    customize: plainRich(docsIntro.customize),
    learn: plainRich(docsIntro.learn),
  }
  return bodies[id]
}
