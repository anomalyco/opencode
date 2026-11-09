import "./product-page.css"
import { Link, Meta, Title } from "@solidjs/meta"
import { createAsync, useNavigate } from "@solidjs/router"
import { createEffect, createSignal, For, Index, lazy, on, onCleanup, onMount, Show, Suspense } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd, softwareData } from "~/component/structured-data"
import { useLanguage } from "~/context/language"
import { productChangelog } from "~/lib/changelog"
import { changelogQuery } from "~/lib/changelog-notes"
import { useI18n } from "~/context/i18n"
import { useContent } from "~/i18n/content"
import { productMarkdown } from "~/lib/product-markdown"
import { ChangelogSettings, ChangelogTimeline, ChangelogUnavailable } from "./changelog-entry"
import { MoreFromAnomaly } from "./product-list"
import { moreProducts, productAreas, productDetails, type PageSlug } from "./product-data"
import { orderedProducts } from "./products-order"
import { designCopy, designEditing } from "./design-copy"
import { CardVideo, InstallTabs, prefersReducedMotion, ProductAction, rescueMedia, useCardShrink } from "./products"
import { imageSources, posterFile, stillSizes, videoSources } from "./media"
import { ProductDownload } from "./download-sections"
import { siteSettings } from "./settings"
import { featureClip, pageMedia, pageScheme } from "./videos"
import { Site } from "./site"
import { useMarkdown } from "./use-markdown"
import { inlineKey } from "~/lib/direction"

// Only rendered inside the settings panel, so it loads with it.
// Settings rows are a development tool (settings-panel.tsx), left out of production.
const PageSettings = import.meta.env.DEV ? lazy(() => import("./page-settings")) : () => undefined

export function ProductPage(props: { slug: PageSlug }) {
  const language = useLanguage()
  const i18n = useI18n()
  const content = useContent()
  const product = () => content().products[props.slug]
  const detail = () => content().productDetails[props.slug]
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
    return { slug, name: content().products[slug].name }
  }

  // The page's colour scheme for the hero's themed files: read while hydrating, so the files match
  // what the hero's inline script picked, then kept in step with the theme and the system setting.
  const [scheme, setScheme] = createSignal(pageScheme())
  onMount(() => {
    const sync = () => setScheme(pageScheme())
    const system = matchMedia("(prefers-color-scheme: dark)")
    const observer = new MutationObserver(sync)
    const root = document.querySelector("[data-site]")
    if (root) observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] })
    system.addEventListener("change", sync)
    onCleanup(() => {
      observer.disconnect()
      system.removeEventListener("change", sync)
    })
  })

  // The left and right arrow keys step through the products, unless focus is somewhere that
  // uses them itself (fields, tabs, the carousel, open menus).
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
  const data = createAsync(async () => {
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
  const markdown = useMarkdown(`/${props.slug}`, productMarkdown(props.slug), { changelog: data })

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
        <div
          data-component="product-hero"
          // Dark product footage, for the fixed marks that scroll over it (surface.ts).
          data-surface="dark"
          data-design="productVideos"
          data-product={props.slug}
          data-empty={pageMedia(siteSettings.productVideos, props.slug, "landscape") ? undefined : ""}
        >
          {/* Only the chosen video set; until it loads the hero shows its backdrop colour. */}
          <Show when={pageMedia(siteSettings.productVideos, props.slug, "landscape")}>
            {(media) => {
              // A hero with a file per theme (videos.ts) leaves its video file out of the server's
              // markup: the script after it picks the theme's before first paint, so only that file
              // is fetched. Hydration keeps the server's attributes; theme changes update them
              // (scheme() reads the same theme).
              const file = () => {
                const themes = media().themes
                if (!themes) return { src: media().src, poster: media().poster }
                const current = scheme()
                return current ? themes[current] : undefined
              }
              // The poster's AVIF and WebP copies (media.tsx): the theme's, and each theme's for the script.
              const poster = () => {
                const current = file()
                return current ? imageSources(current.poster) : undefined
              }
              const themed = (theme: "light" | "dark") => {
                const themes = media().themes
                return themes ? imageSources(themes[theme].poster) : undefined
              }
              return (
                <>
                  {/* The hero's poster is the page's largest paint. A themed one is preloaded for the
                      system's scheme, so the browser finds it in the head instead of waiting for the
                      script below to name it (a visitor whose chosen theme differs from the system's
                      also fetches the other, about 10 KB). */}
                  <Show
                    when={media().themes}
                    fallback={<Link rel="preload" as="image" {...posterPreload(media().poster)} fetchpriority="high" />}
                  >
                    {(themes) => (
                      <>
                        <Link
                          rel="preload"
                          as="image"
                          {...posterPreload(themes().light.poster)}
                          media="(prefers-color-scheme: light)"
                          fetchpriority="high"
                        />
                        <Link
                          rel="preload"
                          as="image"
                          {...posterPreload(themes().dark.poster)}
                          media="(prefers-color-scheme: dark)"
                          fetchpriority="high"
                        />
                      </>
                    )}
                  </Show>
                  {/* Shown as soon as it loads (Site's pre-paint script marks it, before the page's
                      code runs); the video fades in over it once it can play. AVIF then WebP
                      (media.tsx), right-sized for the hero. A themed poster is in the server's markup
                      for the system's scheme (the dark sources match a dark system, the light ones
                      the rest), so the browser finds and loads the right file with no script; the
                      theme script swaps them when the site's chosen theme differs from the
                      system's. Once hydrated, every source follows the page's theme. */}
                  <picture data-still>
                    <Show when={media().themes && themed("dark")}>
                      {(dark) => (
                        <>
                          <Show when={dark().avif}>
                            <source
                              type="image/avif"
                              media="(prefers-color-scheme: dark)"
                              srcset={poster()?.avif ?? dark().avif}
                              data-light-srcset={themed("light")?.avif}
                              data-dark-srcset={dark().avif}
                              sizes={stillSizes.hero}
                            />
                          </Show>
                          <source
                            media="(prefers-color-scheme: dark)"
                            srcset={poster()?.webp ?? poster()?.src ?? dark().webp ?? dark().src}
                            data-light-srcset={themed("light")?.webp ?? themed("light")?.src}
                            data-dark-srcset={dark().webp ?? dark().src}
                            sizes={stillSizes.hero}
                          />
                        </>
                      )}
                    </Show>
                    <Show when={imageSources(media().themes?.light.poster ?? media().poster).avif}>
                      <source
                        type="image/avif"
                        srcset={poster()?.avif ?? themed("light")?.avif}
                        data-light-srcset={themed("light")?.avif}
                        data-dark-srcset={themed("dark")?.avif}
                        sizes={stillSizes.hero}
                      />
                    </Show>
                    <img
                      ref={(img) => img.complete && img.naturalWidth > 0 && img.setAttribute("data-loaded", "")}
                      data-poster
                      src={poster()?.src ?? themed("light")?.src}
                      srcset={poster()?.webp ?? themed("light")?.webp}
                      sizes={stillSizes.hero}
                      data-light={themed("light")?.src}
                      data-dark={themed("dark")?.src}
                      data-light-srcset={themed("light")?.webp}
                      data-dark-srcset={themed("dark")?.webp}
                      width="1920"
                      height={media().themes ? "1200" : "1080"}
                      alt=""
                      aria-hidden="true"
                      fetchpriority="high"
                      onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "")}
                    />
                  </picture>
                  <Show when={media().src}>
                    {/* A themed video's poster stays out of the server's markup: a poster attribute
                        can't follow the system's scheme, so it would load the light file on a dark
                        system too. The theme script names it, and it is hidden until the video
                        plays anyway. */}
                    <HeroVideo src={file()?.src} poster={file()?.poster} themes={media().themes} />
                  </Show>
                  <Show when={media().themes}>
                    <script innerHTML={heroThemeScript} />
                  </Show>
                </>
              )
            }}
          </Show>
        </div>

        <section data-component="product-intro" data-install={exposedInstall() ? "exposed" : undefined}>
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

      {/* Three (or four) clips side by side, each with its title and description below. Rows without a clip yet stay black. */}
      <Show when={showcase().length > 0}>
        <section
          data-component="showcase"
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
                    <Show when={row.clip ? featureClip(row.clip) : undefined}>
                      {(clip) => <CardVideo src={clip().src} poster={clip().poster} />}
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
        <ul data-component="product-features" data-columns={siteSettings.productFeatureColumns.charAt(0)}>
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

      <Show when={areas()}>
        {(filter) => (
          <section data-component="block" data-slot="product-changelog">
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

      <MoreFromAnomaly slot="more-from-anomaly" />
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

/** A hero poster's preload: its AVIF copies for the hero's size (media.tsx), or the file itself. */
function posterPreload(poster: string) {
  const sources = imageSources(poster)
  return sources.avif
    ? { imagesrcset: sources.avif, imagesizes: stillSizes.hero, type: "image/avif" }
    : { href: poster }
}

/**
 * The product hero's video: muted, looping, playing while the hero is on screen and the tab is
 * visible, from a direct load or after a card grows into it. With reduced motion it rests on its
 * first frame and a button plays it.
 */
// Runs as soon as the themed hero is parsed, before first paint. Points the video's sources and
// poster at the page's theme (the site root's data-theme, else the system's), the same choice
// pageScheme() makes on the client. The poster's picture already shows the system's theme, so only
// when the chosen theme differs does it point the picture's sources and img at the chosen one.
const heroThemeScript = `(()=>{const box=document.currentScript.parentElement;const t=box.closest("[data-site]")?.dataset.theme;const s=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";const k=t==="light"||t==="dark"?t:s;if(k!==s)box.querySelectorAll("picture [data-light-srcset]").forEach((e)=>{const v=e.dataset[k+"Srcset"];if(v)e.setAttribute("srcset",v);if(e.dataset[k])e.setAttribute("src",e.dataset[k])});box.querySelectorAll("video[data-light-poster]").forEach((v)=>{v.setAttribute("poster",v.dataset[k+"Poster"]);v.querySelectorAll("source[data-light]").forEach((e)=>e.setAttribute("src",e.dataset[k]));v.load()})})()`

function HeroVideo(props: {
  src?: string
  poster?: string
  themes?: { light: { src: string; poster: string }; dark: { src: string; poster: string } }
}) {
  const i18n = useI18n()
  const [reduced, setReduced] = createSignal(false)
  const [running, setRunning] = createSignal(false)
  // With reduced motion the video plays only after the button is pressed, and stops when pressed again.
  const [wanted, setWanted] = createSignal(false)
  let video!: HTMLVideoElement
  let visible = false

  const sync = () => {
    if (visible && !document.hidden && (!reduced() || wanted())) return void video.play().catch(() => {})
    video.pause()
  }

  // The sources (media.tsx), each with both themes' files for the theme script; a themed hero's are
  // unnamed in the server's markup (props.src is unset until the client knows the theme).
  const sources = () => {
    const light = props.themes && videoSources(props.themes.light.src)
    const dark = props.themes && videoSources(props.themes.dark.src)
    const current = props.src ? videoSources(props.src) : undefined
    return (current ?? light ?? []).map((source, index) => ({
      ...source,
      src: current?.[index]?.src,
      light: light?.[index]?.src,
      dark: dark?.[index]?.src,
    }))
  }
  // A theme change names other files: load again to pick among them.
  createEffect(
    on(
      () => props.src,
      () => video.load(),
      { defer: true },
    ),
  )

  onMount(() => {
    setReduced(prefersReducedMotion())
    rescueMedia(video)
    // The server-rendered video may have loaded before hydration attached onLoadedData.
    if (video.readyState >= 2) video.setAttribute("data-loaded", "")
    const view = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      sync()
    })
    view.observe(video)
    document.addEventListener("visibilitychange", sync)
    onCleanup(() => {
      view.disconnect()
      document.removeEventListener("visibilitychange", sync)
    })
  })

  return (
    <>
      <video
        ref={video}
        poster={props.poster && posterFile(props.poster)}
        data-light-poster={props.themes && posterFile(props.themes.light.poster)}
        data-dark-poster={props.themes && posterFile(props.themes.dark.poster)}
        data-set
        aria-hidden="true"
        // Also after a theme change swaps the file: it plays again once the new one can.
        onLoadedData={(event) => {
          event.currentTarget.setAttribute("data-loaded", "")
          sync()
        }}
        onPlay={() => setRunning(true)}
        onPause={() => setRunning(false)}
        muted
        loop
        playsinline
        preload="auto"
      >
        <Index each={sources()}>
          {(source) => (
            <source
              src={source().src}
              type={source().type}
              media={source().media}
              data-light={source().light}
              data-dark={source().dark}
            />
          )}
        </Index>
      </video>
      <Show when={reduced()}>
        <button
          type="button"
          data-slot="play"
          aria-label={running() ? i18n.t("changelog.media.pause") : i18n.t("changelog.media.play")}
          onClick={() => {
            setWanted(!running())
            sync()
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <Show when={running()} fallback={<path d="M3 1.5v9l7.5-4.5z" />}>
              <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" />
            </Show>
          </svg>
        </button>
      </Show>
    </>
  )
}
