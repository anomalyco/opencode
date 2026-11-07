import { Link } from "@solidjs/meta"
import { createEffect, createSignal, Index, on, onCleanup, onMount, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { imageSources, pageScheme, posterFile, prefersReducedMotion, rescueMedia, stillSizes, videoSources } from "./media"

type HeroFile = { src?: string; poster: string }

/** A hero's files: a video and its poster, one of each per theme, or only the posters for a still. */
export type HeroMedia = HeroFile & { themes?: { light: HeroFile; dark: HeroFile } }

/**
 * The hero at the top of a product page (product-page.tsx) and of Browse's page (extension-page.tsx):
 * the poster, then the video over it once it can play. Black when there is no media.
 */
export function ProductHero(props: { slug: string; media: HeroMedia | undefined; design?: string }) {
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

  return (
    <div
      data-component="product-hero"
      // Dark product footage, for the fixed marks that scroll over it (surface.ts).
      data-surface="dark"
      data-design={props.design}
      data-product={props.slug}
      data-empty={props.media ? undefined : ""}
    >
      {/* Only the chosen video set; until it loads the hero shows its backdrop colour. */}
      <Show when={props.media}>
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
  )
}

/**
 * A hero with a still per theme and no video yet, framed like the themed heroes in videos.ts. Browse's
 * (product-videos/heroes/browse-landscape-*.webp) is an HTML scene of OpenCode driving an agent tab,
 * rendered with Playwright.
 */
export function heroStills(slug: string) {
  const file = (theme: string) => `/product-videos/heroes/${slug}-landscape-${theme}.webp`
  return { poster: file("light"), themes: { light: { poster: file("light") }, dark: { poster: file("dark") } } }
}

/** A hero poster's preload: its AVIF copies for the hero's size (media.tsx), or the file itself. */
function posterPreload(poster: string) {
  const sources = imageSources(poster)
  return sources.avif
    ? { imagesrcset: sources.avif, imagesizes: stillSizes.hero, type: "image/avif" }
    : { href: poster }
}

// Runs as soon as the themed hero is parsed, before first paint. Points the video's sources and
// poster at the page's theme (the site root's data-theme, else the system's), the same choice
// pageScheme() makes on the client. The poster's picture already shows the system's theme, so only
// when the chosen theme differs does it point the picture's sources and img at the chosen one.
const heroThemeScript = `(()=>{const box=document.currentScript.parentElement;const t=box.closest("[data-site]")?.dataset.theme;const s=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";const k=t==="light"||t==="dark"?t:s;if(k!==s)box.querySelectorAll("picture [data-light-srcset]").forEach((e)=>{const v=e.dataset[k+"Srcset"];if(v)e.setAttribute("srcset",v);if(e.dataset[k])e.setAttribute("src",e.dataset[k])});box.querySelectorAll("video[data-light-poster]").forEach((v)=>{v.setAttribute("poster",v.dataset[k+"Poster"]);v.querySelectorAll("source[data-light]").forEach((e)=>e.setAttribute("src",e.dataset[k]));v.load()})})()`

/**
 * The product hero's video: muted, looping, playing while the hero is on screen and the tab is
 * visible, from a direct load or after a card grows into it. With reduced motion it rests on its
 * first frame and a button plays it.
 */
function HeroVideo(props: { src?: string; poster?: string; themes?: { light: HeroFile; dark: HeroFile } }) {
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
    const light = props.themes?.light.src ? videoSources(props.themes.light.src) : undefined
    const dark = props.themes?.dark.src ? videoSources(props.themes.dark.src) : undefined
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
