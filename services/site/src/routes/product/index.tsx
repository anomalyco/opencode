import "./index.css"
import "~/component/site/hero-title.css"
import { titleCells } from "~/component/site/hero-title"
import { Meta, Title } from "@solidjs/meta"
import { createMemo, Show } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd } from "~/component/structured-data"
import { DownloadSections } from "~/component/site/download-sections"
import { extensionPages } from "~/component/site/extension-data"
import { SectionHeading } from "~/component/site/on-this-page"
import { ProductGrid } from "~/component/site/products"
import { anomalyMarks, ProductList } from "~/component/site/product-list"
import { BrowseMark } from "~/component/site/icons"
import { anomalyProducts } from "~/component/site/links"
import { appsSource } from "~/i18n/content/areas/apps"
import "~/component/site/product-list.css"
import { productsOrderScript } from "~/component/site/products-order"
import { Site } from "~/component/site/site"
import { PageTitle } from "~/component/site/sticky-title"
import { designCopy } from "~/component/site/design-copy"
import { useMarkdown } from "~/component/site/use-markdown"
import { useLanguage } from "~/context/language"
import { useI18n } from "~/context/i18n"
import { useArea } from "~/i18n/content"
import { extensionsSource } from "~/i18n/content/areas/extensions"
import { siteSettings } from "~/component/site/settings"

export default function Product() {
  const language = useLanguage()
  const i18n = useI18n()
  const extensionCopy = useArea("extensions", extensionsSource)
  const appCopy = useArea("apps", appsSource)
  const productLandingPages = () => extensionPages.filter((extension) => extension.product)
  const extensionPagesListed = () => extensionPages.filter((extension) => !extension.product)
  const moreProducts = createMemo(() => [
    ...productLandingPages().map((extension) => ({
      name: extensionCopy()[extension.slug].name,
      description: extensionCopy()[extension.slug].body,
      href: language.route(`/product/${extension.slug}`),
      icon: <BrowseMark />,
    })),
    ...anomalyProducts.map((app) => ({
      name: app.name,
      description: appCopy()[app.id].body,
      href: app.href,
      external: true,
      icon: anomalyMarks[app.id](),
    })),
  ])
  const title = () => i18n.t("product.title")
  const description = () => i18n.t("product.meta.description")
  const markdown = useMarkdown("/product", (context, pages) => pages.productsMarkdown(context))

  return (
    <Site page="products" markdown={markdown}>
      <Title>{title()}</Title>
      <ShareMeta title={title()} description={description()} image={ogImage("/product")} />
      <LocaleLinks path="/product" />
      <Meta name="description" content={description()} />
      <JsonLd
        data={breadcrumbData([
          { name: i18n.t("nav.home"), path: language.route("/") },
          { name: i18n.t("site.nav.product"), path: language.route("/product") },
        ])}
      />

      {/* The home hero's options and title length, so the title is set at the home title's size
          and the cards below land where the home page's do (hero-title.css). */}
      <section
        data-component="hero"
        data-section="hero"
        data-design="hero heroTitleSize"
        data-variant={siteSettings.hero}
        data-title-size={siteSettings.heroTitleSize}
        style={{
          "--title-chars": titleCells(designCopy("home.hero.title", i18n.t("home.hero.title"))),
        }}
      >
        <PageTitle title={i18n.t("site.nav.product")} />
        <p data-design-copy="products.hero.body">{designCopy("products.hero.body", i18n.t("product.hero.subtitle"))}</p>
      </section>

      <ProductGrid />
      {/* Right after the grid, so a saved order (Design mode, development only) applies before it paints. */}
      {import.meta.env.DEV && <script innerHTML={productsOrderScript} />}

      {/* Products with a light page of their own, and Anomaly's other open source products. */}
      <Show when={moreProducts().length > 0}>
        <section data-component="block" data-slot="products-more" data-section="more-products">
          <SectionHeading id="more-products" title={i18n.t("site.moreProducts")} label />
          <div data-slot="body">
            <ProductList items={moreProducts()} />
          </div>
        </section>
      </Show>

      {/* Hidden while no extension is listed; SSH and WSL are commented out in extension-data.ts. */}
      <Show when={extensionPagesListed().length > 0}>
        <section data-component="block" data-slot="products-extensions" data-section="extensions">
          <SectionHeading id="extensions" title={i18n.t("site.extensions")} label />
          <div data-slot="body">
            {/* Each extension's page, with its install steps; a blank tile until one has an icon. */}
            <ProductList
              items={extensionPagesListed().map((extension) => ({
                name: extensionCopy()[extension.slug].name,
                description: extensionCopy()[extension.slug].body,
                href: language.route(`/extensions/${extension.slug}`),
                icon: <BrowseMark />,
              }))}
            />
          </div>
        </section>
      </Show>

      {/* Everything the download page has, in this page's layout. */}
      <DownloadSections
        columns
        apps={false}
        editors={false}
        heading={(id, title) => <SectionHeading id={id} title={title} label />}
      />
    </Site>
  )
}
