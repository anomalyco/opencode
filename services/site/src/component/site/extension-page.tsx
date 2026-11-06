import "./product-page.css"
import { Meta, Title } from "@solidjs/meta"
import { useNavigate } from "@solidjs/router"
import { For, onCleanup, onMount } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd, softwareData } from "~/component/structured-data"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { useArea } from "~/i18n/content"
import { extensionsSource } from "~/i18n/content/areas/extensions"
import { extensionMarkdown } from "~/lib/product-markdown"
import { ExtensionDownload } from "./download-sections"
import { extensionPages, type ExtensionSlug } from "./extension-data"
import { NewTab } from "./icons"
import { MoreFromAnomaly } from "./product-list"
import { siteSettings } from "./settings"
import { Site } from "./site"
import { useMarkdown } from "./use-markdown"
import { inlineKey } from "~/lib/direction"

/**
 * An extension's page: a lighter product page with a black hero until there is real footage, what
 * it does, how to get it and its source. The arrow keys step through the extensions only.
 */
export function ExtensionPage(props: { slug: ExtensionSlug }) {
  const language = useLanguage()
  const i18n = useI18n()
  const extensionCopy = useArea("extensions", extensionsSource)
  const navigate = useNavigate()
  const data = () => extensionPages.find((item) => item.slug === props.slug)!
  const extension = () => extensionCopy()[props.slug]
  const path = () => `/extensions/${props.slug}`
  const neighbour = (step: number) => {
    const index = extensionPages.findIndex((item) => item.slug === props.slug)
    const slug = extensionPages[(index + step + extensionPages.length) % extensionPages.length].slug
    return { slug, name: extensionCopy()[slug].name }
  }
  const markdown = useMarkdown(path(), extensionMarkdown(props.slug))
  const command = () => data().install.command

  onMount(() => {
    const step = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable], [role="tablist"]')) return
      navigate(language.route(`/extensions/${neighbour(inlineKey(event) === "ArrowLeft" ? -1 : 1).slug}`))
    }
    window.addEventListener("keydown", step)
    onCleanup(() => window.removeEventListener("keydown", step))
  })

  return (
    <Site page="product" markdown={markdown}>
      <Title>{extension().title}</Title>
      <ShareMeta
        title={extension().title}
        description={extension().description}
        image={ogImage(`/extensions/${props.slug}`)}
      />
      <LocaleLinks path={path()} />
      <Meta name="description" content={extension().description} />
      <JsonLd
        data={softwareData({
          name: `OpenCode ${extension().name}`,
          description: extension().description,
          path: language.route(path()),
          image: ogImage(`/extensions/${props.slug}`).src,
          operatingSystem: data().operatingSystem ?? "macOS, Windows, Linux",
        })}
      />
      <JsonLd
        data={breadcrumbData([
          { name: i18n.t("nav.home"), path: language.route("/") },
          { name: i18n.t("site.nav.product"), path: language.route("/product") },
          { name: extension().name, path: language.route(path()) },
        ])}
      />

      <nav data-component="breadcrumb" aria-label={i18n.t("site.breadcrumb")}>
        <a href={language.route("/product")} link>
          {i18n.t("site.nav.product")}
        </a>
        <span aria-hidden="true">|</span>
        <span aria-current="page">{extension().name}</span>
      </nav>

      {/* Fixed beside the GitHub mark in the top-right corner (product-page.css). */}
      <nav data-component="product-cycle" aria-label={i18n.t("site.cycle.extensions")}>
        <a
          href={language.route(`/extensions/${neighbour(-1).slug}`)}
          aria-label={i18n.t("site.cycle.previousExtension", { name: neighbour(-1).name })}
          data-tip={i18n.t("site.cycle.previous", { name: neighbour(-1).name })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 4L6 8L10 12" stroke="currentColor" stroke-width="1" />
          </svg>
        </a>
        <a
          href={language.route(`/extensions/${neighbour(1).slug}`)}
          aria-label={i18n.t("site.cycle.nextExtension", { name: neighbour(1).name })}
          data-tip={i18n.t("site.cycle.next", { name: neighbour(1).name })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1" />
          </svg>
        </a>
      </nav>

      <div data-slot="first-screen">
        {/* Plain black until there is real footage of the extension. */}
        <div data-component="product-hero" data-product={props.slug} data-empty />

        <section data-component="product-intro">
          <div data-slot="copy">
            <h1>{extension().name}</h1>
            <p>{extension().intro}</p>
          </div>
          <div data-slot="action">
            <a href={data().source} target="_blank" rel="noopener" data-component="site-button">
              {i18n.t("site.action.viewSource")}
              <NewTab />
            </a>
          </div>
        </section>
      </div>

      <ul data-component="product-features" data-columns={siteSettings.productFeatureColumns.charAt(0)}>
        <For each={extension().features}>
          {(feature) => (
            <li>
              <strong>{feature.title}</strong>
              <span>{feature.body}</span>
            </li>
          )}
        </For>
      </ul>

      <ExtensionDownload lead={extension().install} command={command()} />

      <MoreFromAnomaly slot="more-from-anomaly" />
    </Site>
  )
}
