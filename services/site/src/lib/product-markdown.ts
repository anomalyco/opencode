import { anomalyApps, anomalyProducts } from "~/component/site/links"
import { extensionPages, type ExtensionSlug } from "~/component/site/extension-data"
import {
  acpDocs,
  extensions,
  installs,
  mobileStores,
  productAreas,
  productDetails,
  allProductPages,
  productPages,
  sdkDocs,
  sdkSnippet,
  type PageSlug,
} from "~/component/site/product-data"
import { changelogEntryMarkdown } from "~/lib/changelog-markdown"
import { downloadSectionsMarkdown, productDownloadMarkdown, storeMarkdown } from "~/lib/download-content"
import { changelogQuery } from "~/lib/changelog-notes"
import { desktopBuilds, desktopInstall, getDownloadHref } from "~/lib/download"
import { config } from "~/config"
import { fourthClips } from "~/component/site/videos"
import { english } from "~/i18n/english"
import { blocks, codeFence, link, type MarkdownContext } from "~/lib/markdown"

/** A product page as Markdown: the intro, how to get it, its features and its latest releases. */
export function productMarkdown(slug: PageSlug) {
  return (context: MarkdownContext) => {
    const product = allProductPages.find((item) => item.slug === slug)!
    const view = context.changelog
    const entries = view?.entries ?? []
    const areas = productAreas[slug]
    return blocks(
      `# ${product.name}`,
      productDetails[slug].intro,
      // The clips the page shows: the first three, and a fourth once its footage exists or when it
      // has no clip at all (a row whose clip is still to come).
      ...productDetails[slug].showcase
        .filter((row, index) => index < 3 || !row.clip || fourthClips.includes(row.clip.split("/").pop() ?? ""))
        .map((row) => blocks(`## ${row.title}`, row.body).trimEnd()),
      ...(productDetails[slug].features.length > 0
        ? [
            "## Features",
            productDetails[slug].features.map((feature) => `- **${feature.title}:** ${feature.body}`).join("\n"),
          ]
        : []),
      productDownloadMarkdown(slug, context),
      `## ${context.t("site.companions")}`,
      anomalyApps.map((app) => `- ${appMarkdown(app, context)}: ${app.body}`).join("\n"),
      ...(areas ? changelogBlocks(product.name, areas, context) : []),
    )
  }
}

/** The /product hero subtitle; Design mode offers alternatives ("products.hero.body"). */
export const productsSubtitle = english["product.hero.subtitle"]

/** The /product page as Markdown: every product with a page, then more products from Anomaly. */
export function productsMarkdown(context: MarkdownContext) {
  return blocks(
    "# Product",
    productsSubtitle,
    productPages
      .map((product) => `- ${link(product.name, context.route(`/${product.slug}`))}: ${product.body}`)
      .join("\n"),
    "## More products",
    [
      ...extensionPages
        .filter((extension) => extension.product)
        .map((extension) => `- ${link(extension.name, context.route(`/product/${extension.slug}`))}: ${extension.body}`),
      // Browse is listed above with its own page.
      ...anomalyProducts
        .filter((app) => !extensionPages.some((extension) => extension.product && extension.slug === app.id))
        .map((app) => `- ${appMarkdown(app, context)}: ${app.body}`),
    ].join("\n"),
    ...(extensionPages.some((extension) => !extension.product)
      ? [
          "## Extensions",
          extensionPages
            .filter((extension) => !extension.product)
            .map(
              (extension) =>
                `- ${link(extension.name, context.route(`/extensions/${extension.slug}`))}: ${extension.body}`,
            )
            .join("\n"),
        ]
      : []),
    // The download page's sections, as at the bottom of the page (without its hero or the apps).
    downloadSectionsMarkdown(context, {
      apps: false,
      editors: false,
    }).trimEnd(),
  )
}

/** A product page's changelog block: its newest entries, then a link to the changelog with its filter. */
function changelogBlocks(name: string, areas: string[], context: MarkdownContext) {
  const view = context.changelog
  const entries = view?.entries ?? []
  return [
    "## Changelog",
    !view?.ok &&
      `${context.t("changelog.unavailable")} ${link(context.t("changelog.viewReleases"), `${config.github.repoUrl}/releases`)}`,
    view?.ok && entries.length === 0 && `${name} is new. Its updates will appear here.`,
    ...entries.map((entry) =>
      changelogEntryMarkdown(entry, 3, {
        context,
        limit: 4,
        more: context.route(`/changelog/${entry.releases[0].tag}`),
        dated: true,
      }),
    ),
    link(
      context.t("changelog.seeAll"),
      context.route(`/changelog${changelogQuery({ filter: view?.filter ?? areas })}`),
    ),
  ]
}

/** How to get a product: its downloads, install commands or docs. */
export function productActionMarkdown(slug: PageSlug, context: MarkdownContext) {
  if (slug === "desktop")
    return blocks(
      `Download: ${link("all builds", context.route("/desktop#download"))}`,
      desktopBuilds.map((build) => `- ${link(context.t(build.label), getDownloadHref(build.id))}`).join("\n"),
      codeFence("bash", desktopInstall.command),
    ).trimEnd()
  if (slug === "mobile")
    return `Download: ${mobileStores.map((store) => storeMarkdown({ ...store, href: store.href.startsWith("/") ? context.route(store.href) : store.href })).join(", ")}`
  if (slug === "ide")
    return `Install: ${link("VS Code Marketplace", extensions.href)}, or run \`opencode\` in your editor's integrated terminal. ACP editors: ${link("ACP docs", context.route(acpDocs))}`
  if (slug === "terminal" || slug === "mini")
    return blocks(
      "Install with any of these:",
      codeFence("bash", installs.map((item) => `# ${item.id}\n${item.command}`).join("\n\n")),
    ).trimEnd()
  return blocks(
    codeFence("ts", sdkSnippet.replace(/<[^>]+>/g, "")),
    `Docs: ${link("SDK", context.route(sdkDocs))}`,
  ).trimEnd()
}

/** An extension's page as Markdown: what it does, its features, how to install it and its source. */
export function extensionMarkdown(slug: ExtensionSlug) {
  return (context: MarkdownContext) => {
    const extension = extensionPages.find((item) => item.slug === slug)!
    return blocks(
      `# ${extension.name}`,
      extension.intro,
      "## Features",
      extension.features.map((feature) => `- **${feature.title}:** ${feature.body}`).join("\n"),
      "## Install",
      extension.store && `Add to Chrome from the ${link("Chrome Web Store", extension.store)}.`,
      extension.store
        ? extension.install.lead.replace(/\[([^\]]+)\]/g, (_, text) => link(text, extension.store!))
        : extension.install.lead.replace(/\[([^\]]+)\]/g, "$1"),
      extension.install.command && codeFence("bash", extension.install.command),
      extension.install.commands && codeFence("bash", extension.install.commands.map((item) => item.command).join("\n")),
      `Source: ${link(extension.source.replace("https://", ""), extension.source)}`,
      "## More from Anomaly",
      anomalyProducts
        .filter((app) => app.id !== slug)
        .map((app) => `- ${appMarkdown(app, context)}: ${app.body}`)
        .join("\n"),
    )
  }
}

/** An app's name linked to its page, on this site in the reader's language or on its own site. */
function appMarkdown(app: { name: string; href: string }, context: MarkdownContext) {
  return link(app.name, app.href.startsWith("/") ? context.route(app.href) : app.href)
}
