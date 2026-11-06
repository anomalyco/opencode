import "./index.css"
import "~/component/site/hero-title.css"
import { titleCells } from "~/component/site/hero-title"
import { Meta, Title } from "@solidjs/meta"
import { Show } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd } from "~/component/structured-data"
import { DownloadSections } from "~/component/site/download-sections"
import { extensionPages } from "~/component/site/extension-data"
import { SectionHeading } from "~/component/site/on-this-page"
import { ProductGrid } from "~/component/site/products"
import { MoreFromAnomaly, ProductList } from "~/component/site/product-list"
import { BrowseMark, GitHubMark, GitLabMark } from "~/component/site/icons"
import { downloadContent } from "~/lib/download-content"
import "~/component/site/product-list.css"
import { productsOrderScript } from "~/component/site/products-order"
import { Site } from "~/component/site/site"
import { PageTitle } from "~/component/site/sticky-title"
import { designCopy } from "~/component/site/design-copy"
import { useMarkdown } from "~/component/site/use-markdown"
import { useLanguage } from "~/context/language"
import { productsMarkdown } from "~/lib/product-markdown"
import { useI18n } from "~/context/i18n"
import { localize, useContent } from "~/i18n/content"
import { siteSettings } from "~/component/site/settings"

export default function Product() {
  const language = useLanguage()
  const i18n = useI18n()
  const content = useContent()
  const title = () => i18n.t("product.title")
  const description = () => i18n.t("product.meta.description")
  const download = () => localize(language.locale(), "download", downloadContent(i18n.t, language.route))
  const markdown = useMarkdown("/product", productsMarkdown)

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

      {/* Hidden while extensionPages is empty. */}
      <Show when={extensionPages.length > 0}>
        <section data-component="block" data-slot="products-extensions">
          <SectionHeading id="extensions" title={i18n.t("site.extensions")} label />
          <div data-slot="body">
            {/* Each extension's page, with its install steps; a blank tile until one has an icon. */}
            <ProductList
              items={extensionPages.map((extension) => ({
                name: content().extensions[extension.slug].name,
                description: content().extensions[extension.slug].body,
                href: language.route(`/extensions/${extension.slug}`),
                icon: <BrowseMark />,
              }))}
            />
          </div>
        </section>
      </Show>

      {/* /product#download lands here, the first of the download page's sections on this page. */}
      <section data-component="block" data-slot="products-integrations">
        <SectionHeading id="download" title={download().integrations.title} label />
        <div data-slot="body">
          <ProductList
            items={download().integrations.items.map((integration) => ({
              name: integration.label,
              description: integration.body,
              href: integration.href,
              external: true,
              icon: integration.id === "github" ? <GitHubMark /> : <GitLabMark />,
            }))}
          />
        </div>
      </section>

      {/* Everything the download page has, in this page's layout (/product#download). */}
      <DownloadSections
        columns
        apps={false}
        editors={false}
        integrations={false}
        beforeFaq={<MoreFromAnomaly slot="products-anomaly" />}
        heading={(id, title) => <SectionHeading id={id} title={title} label />}
      />
    </Site>
  )
}
