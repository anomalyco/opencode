import "./product-page.css"
import { Meta, Title } from "@solidjs/meta"
import { useNavigate } from "@solidjs/router"
import { pageData } from "~/lib/page-data"
import { For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd, softwareData } from "~/component/structured-data"
import { useLanguage } from "~/context/language"
import { productChangelog } from "~/lib/changelog"
import { changelogQuery } from "~/lib/changelog-notes"
import { useI18n } from "~/context/i18n"
import { useArea } from "~/i18n/content"
import { productDetailsSource } from "~/i18n/content/areas/product-details"
import { productsSource } from "~/i18n/content/areas/products"
import { ChangelogSettings, ChangelogTimeline, ChangelogUnavailable } from "./changelog-entry"
import { Companions } from "./companions"
import { moreProducts, productAreas, type PageSlug } from "./product-data"
import { productDetails } from "./product-details"
import { orderedProducts } from "./products-order"
import { designCopy, designEditing } from "./design-copy"
import { CardVideo, InstallTabs, ProductAction, useCardShrink } from "./products"
import { Still, stillSizes } from "./media"
import { LogoIcon } from "./marks"
import { ProductDownload } from "./download-sections"
import { ProductHero } from "./product-hero"
import { siteSettings } from "./settings"
import { featureClip, pageMedia } from "./videos"
import { Site } from "./site"
import { useMarkdown } from "./use-markdown"
import { inlineKey } from "~/lib/direction"

// Only rendered inside the settings panel, so it loads with it.
// Settings rows are a development tool (settings-panel.tsx), left out of production.
const PageSettings = import.meta.env.DEV ? lazy(() => import("./page-settings")) : () => undefined

export function ProductPage(props: { slug: PageSlug }) {
  const language = useLanguage()
  const i18n = useI18n()
  const detailCopy = useArea("productDetails", productDetailsSource)
  const productCopy = useArea("products", productsSource)
  const product = () => productCopy()[props.slug]
  const detail = () => detailCopy()[props.slug]
  // The products after the carousel's four have no share image of their own yet.
  const shareImage = () => ogImage(`/${props.slug}`)
  const areas = () => productAreas[props.slug]
  const exposedInstall = () => props.slug === "terminal" && siteSettings.terminalInstall === "exposed"
  const navigate = useNavigate()
  // Every product on /product in its order there (Design mode can change it), wrapping at both ends.
  const neighbour = (step: number) => {
    const order = orderedProducts()
    const index = order.findIndex((item) => item.slug === props.slug)
    const slug = order[(index + step + order.length) % order.length].slug
    return { slug, name: productCopy()[slug].name }
  }

  // The left and right arrow keys step through the products, unless focus is somewhere that
  // uses them itself (fields, tabs, the carousel, open menus). On a static page,
  // src/client/entry.ts.
  onMount(() => {
    const step = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return
      const target = event.target as HTMLElement
      if (
        target.closest(
          'input, textarea, select, [contenteditable], [role="tablist"], [data-slot="track"], [data-slot="menu"]',
        )
      )
        return
      navigate(language.route(`/${neighbour(inlineKey(event) === "ArrowLeft" ? -1 : 1).slug}`))
    }
    window.addEventListener("keydown", step)
    onCleanup(() => window.removeEventListener("keydown", step))
  })

  // Back to the home page: the hero shrinks into its carousel card.
  useCardShrink(() => props.slug)

  // The newest three entries with notes in this product's areas, then a link to the changelog with that filter.
  const data = pageData(async () => {
    const filter = areas()
    return filter ? productChangelog(filter) : undefined
  })
  const releases = () => data()?.entries ?? []
  // The carousel's four keep a black row for a clip still to come; the others show only real clips.
  const showcase = () =>
    productDetails[props.slug].showcase
      .map((row, index) => ({ ...row, ...detail().showcase[index] }))
      .slice(0, Number(siteSettings.featureClipCount))
      .filter((row) => row.clip || !moreProducts.some((item) => item.slug === props.slug))
  const markdown = useMarkdown(`/${props.slug}`, (context, pages) => pages.productMarkdown(props.slug)(context), {
    changelog: data,
  })

  return (
    <Site
      page="product"
      settings={
        import.meta.env.DEV
          ? (section) => (
              <>
                <PageSettings section={section} terminal={props.slug === "terminal"} />
                <ChangelogSettings section={section} />
              </>
            )
          : undefined
      }
      markdown={markdown}
    >
      <Title>{detail().title}</Title>
      <ShareMeta title={detail().title} description={detail().description} image={shareImage()} />
      <LocaleLinks path={`/${props.slug}`} />
      <Meta name="description" content={detail().description} />
      <JsonLd
        data={softwareData({
          name: product().name.startsWith("OpenCode") ? product().name : `OpenCode ${product().name}`,
          description: detail().description,
          path: language.route(`/${props.slug}`),
          image: shareImage().src,
          operatingSystem: productDetails[props.slug].operatingSystem,
        })}
      />
      <JsonLd
        data={breadcrumbData([
          { name: i18n.t("nav.home"), path: language.route("/") },
          { name: i18n.t("site.nav.product"), path: language.route("/product") },
          { name: product().name, path: language.route(`/${props.slug}`) },
        ])}
      />

      <nav data-component="breadcrumb" aria-label={i18n.t("site.breadcrumb")}>
        <a href={language.route("/product")} link>
          {i18n.t("site.nav.product")}
        </a>
        <span aria-hidden="true">|</span>
        <span aria-current="page">{product().name}</span>
      </nav>

      {/* Fixed beside the GitHub mark in the top-right corner (product-page.css). */}
      <nav data-component="product-cycle" aria-label={i18n.t("site.cycle.products")}>
        <a
          href={language.route(`/${neighbour(-1).slug}`)}
          aria-label={i18n.t("site.cycle.previousProduct", { name: neighbour(-1).name })}
          data-tip={i18n.t("site.cycle.previous", { name: neighbour(-1).name })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 4L6 8L10 12" stroke="currentColor" stroke-width="1" />
          </svg>
        </a>
        <a
          href={language.route(`/${neighbour(1).slug}`)}
          aria-label={i18n.t("site.cycle.nextProduct", { name: neighbour(1).name })}
          data-tip={i18n.t("site.cycle.next", { name: neighbour(1).name })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1" />
          </svg>
        </a>
      </nav>

      <div data-slot="first-screen">
        <ProductHero
          slug={props.slug}
          media={pageMedia(siteSettings.productVideos, props.slug, "landscape")}
          design="productVideos"
        />

        <section
          data-component="product-intro"
          data-section="intro"
          data-install={exposedInstall() ? "exposed" : undefined}
        >
          <div data-slot="copy">
            <h1>{product().name}</h1>
            <p data-design-copy={`product.${props.slug}.intro`}>
              <Show
                when={props.slug === "desktop" && !designEditing(`product.${props.slug}.intro`)}
                fallback={designCopy(`product.${props.slug}.intro`, detail().intro)}
              >
                {/* Each OS name links to its builds in this page's Download section. */}
                <For each={designCopy(`product.${props.slug}.intro`, detail().intro).split(/(macOS|Windows|Linux)/)}>
                  {(part) => (
                    <Show when={/^(macOS|Windows|Linux)$/.test(part)} fallback={part}>
                      <a href={`#${part.toLowerCase()}`}>{part}</a>
                    </Show>
                  )}
                </For>
              </Show>
            </p>
          </div>
          <div data-slot="action">
            <Show when={exposedInstall()} fallback={<ProductAction slug={props.slug} both />}>
              <InstallTabs />
            </Show>
          </div>
        </section>
      </div>

      {/* Three (or four) clips side by side, each with its title and description below. Rows without a clip yet show a placeholder. */}
      <Show when={showcase().length > 0}>
        <section
          data-component="showcase"
          data-section="showcase"
          data-design="featureClipStyle featureClipCount"
          data-count={siteSettings.featureClipCount}
          data-media={productDetails[props.slug].showcaseMedia === false ? "none" : undefined}
        >
          <h2 data-slot="sr-only">{i18n.t("site.product.features")}</h2>
          <For each={showcase()}>
            {(row) => (
              <article data-slot="row">
                <Show when={productDetails[props.slug].showcaseMedia !== false}>
                  <div data-slot="media">
                    {/* Rests on its first frame and plays on hover (in view on touch screens), like
                      the carousel cards. */}
                    {/* A clip whose video isn't uploaded shows its still; a row with no footage
                      yet shows the logo, dimmed, on the black frame. */}
                    <Show
                      when={row.clip ? featureClip(row.clip) : undefined}
                      fallback={
                        <div data-slot="placeholder">
                          <LogoIcon />
                        </div>
                      }
                    >
                      {(clip) => (
                        <Show
                          when={clip().src}
                          fallback={<Still src={clip().poster} sizes={stillSizes.clip} alt="" loading="lazy" />}
                        >
                          {(src) => <CardVideo src={src()} poster={clip().poster} />}
                        </Show>
                      )}
                    </Show>
                  </div>
                </Show>
                <div data-slot="copy">
                  <h3>{row.title}</h3>
                  <p>{row.body}</p>
                </div>
              </article>
            )}
          </For>
        </section>
      </Show>

      <Show when={detail().features.length > 0}>
        <ul
          data-component="product-features"
          data-section="features"
          data-columns={siteSettings.productFeatureColumns.charAt(0)}
        >
          <For each={detail().features}>
            {(feature) => (
              <li>
                <strong>{feature.title}</strong>
                <span>{feature.body}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <ProductDownload slug={props.slug} />

      <Companions />

      <Show when={areas()}>
        {(filter) => (
          <section data-component="block" data-slot="product-changelog" data-section="changelog">
            <h2 data-slot="label">{i18n.t("nav.changelog")}</h2>
            {/* Its own boundary, so the page (and the card growing into its hero) does not wait for
            GitHub's releases, which can take over a second. */}
            <Suspense>
              <Show
                when={releases().length > 0}
                fallback={
                  <div data-slot="body">
                    {/* No releases at all means GitHub failed; a product with none of its own is new. */}
                    <Show when={data()?.ok} fallback={<ChangelogUnavailable />}>
                      <p data-slot="lead">{i18n.t("site.product.isNew", { name: product().name })}</p>
                    </Show>
                  </div>
                }
              >
                <ChangelogTimeline entries={releases()} level={3} limit={4} more />
              </Show>
            </Suspense>
            {/* Reading the data outside a boundary would hold the whole page (and the card's grow)
                until GitHub answers, so the link uses the product's own areas until then. */}
            <Suspense fallback={<SeeAll filter={filter()} />}>
              <SeeAll filter={data()?.filter ?? filter()} />
            </Suspense>
          </section>
        )}
      </Show>
    </Site>
  )
}

/** The link from a product page's changelog to the full changelog, filtered to its areas. */
function SeeAll(props: { filter: string[] }) {
  const language = useLanguage()
  const i18n = useI18n()
  return (
    <a href={language.route(`/changelog${changelogQuery({ filter: props.filter })}`)} data-slot="more">
      {i18n.t("changelog.seeAll")}
    </a>
  )
}
