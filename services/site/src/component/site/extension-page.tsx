import "./product-page.css"
import { Meta, Title } from "@solidjs/meta"
import { useNavigate } from "@solidjs/router"
import { For, onCleanup, onMount, Show } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd, softwareData } from "~/component/structured-data"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { useArea } from "~/i18n/content"
import { extensionsSource } from "~/i18n/content/areas/extensions"
import { ExtensionDownload } from "./download-sections"
import { extensionPages, type ExtensionSlug } from "./extension-data"
import { NewTab } from "./icons"
import { heroStills, ProductHero } from "./product-hero"
import { MoreFromAnomaly } from "./product-list"
import { siteSettings } from "./settings"
import { Site } from "./site"
import { useMarkdown } from "./use-markdown"
import { inlineKey } from "~/lib/direction"

/**
 * A light product page: what it does, how to get it and its source. Browse is a product, served at
 * /product/browse; an extension page would sit at /extensions/<slug>. The arrow keys step through
 * the extensions only, when there is more than one.
 */
export function ExtensionPage(props: { slug: ExtensionSlug; path?: string }) {
  const language = useLanguage()
  const i18n = useI18n()
  const extensionCopy = useArea("extensions", extensionsSource)
  const navigate = useNavigate()
  const data = () => extensionPages.find((item) => item.slug === props.slug)!
  const extension = () => extensionCopy()[props.slug]
  const path = () => props.path ?? `/extensions/${props.slug}`
  const neighbour = (step: number) => {
    const index = extensionPages.findIndex((item) => item.slug === props.slug)
    const slug = extensionPages[(index + step + extensionPages.length) % extensionPages.length].slug
    return { slug, name: extensionCopy()[slug].name }
  }
  const markdown = useMarkdown(path(), (context, pages) => pages.extensionMarkdown(props.slug)(context))
  const command = () => data().install.command

  onMount(() => {
    const step = (event: KeyboardEvent) => {
      if (extensionPages.length < 2 || data().product) return
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
      <ShareMeta title={extension().title} description={extension().description} image={ogImage(path())} />
      <LocaleLinks path={path()} />
      <Meta name="description" content={extension().description} />
      <JsonLd
        data={softwareData({
          name: `OpenCode ${extension().name}`,
          description: extension().description,
          path: language.route(path()),
          image: ogImage(path()).src,
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
      <Show when={extensionPages.length > 1 && !data().product}>
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
      </Show>

      <div data-slot="first-screen">
        {/* Plain black until the extension has a hero. */}
        <ProductHero slug={props.slug} media={data().hero ? heroStills(props.slug) : undefined} />

        <section data-component="product-intro" data-section="intro">
          <div data-slot="copy">
            <h1>{extension().name}</h1>
            <p>{extension().intro}</p>
          </div>
          <div data-slot="action">
            <div data-component="site-buttons">
              <Show when={data().store}>
                {(store) => (
                  <a href={store()} target="_blank" rel="noopener" data-component="site-button">
                    {i18n.t("site.action.addToChrome")}
                    <NewTab />
                  </a>
                )}
              </Show>
              <a
                href={data().source}
                target="_blank"
                rel="noopener"
                data-component="site-button"
                data-variant="neutral"
              >
                {i18n.t("site.action.viewSource")}
                <NewTab />
              </a>
            </div>
          </div>
        </section>
      </div>

      <ul
        data-component="product-features"
        data-section="features"
        data-columns={siteSettings.productFeatureColumns.charAt(0)}
      >
        <For each={extension().features}>
          {(feature) => (
            <li>
              <strong>{feature.title}</strong>
              <span>{feature.body}</span>
            </li>
          )}
        </For>
      </ul>

      <ExtensionDownload lead={extension().install} command={command()} commands={data().install.commands} />

      <MoreFromAnomaly slot="more-from-anomaly" exclude={props.slug} />
    </Site>
  )
}
