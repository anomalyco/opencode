import { Link, Meta, Title } from "@solidjs/meta"
import { createAsync, query, useLocation, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { baseUrl } from "../../lib/language"
import { loadHomePage } from "../../lib/page-data"
import { drawShareCard, loadShareFonts, mainLength, shareSizes, type ShareCard } from "../../share/card"
import { readEmbed, unpackCard } from "../../share/embed"
import { shareTitles } from "../../share/embed"
import { homeShareCard } from "../../share/sections"
import { setStatsPageCacheHeaders } from "../stats-cache"
import "./embed.css"

const getData = query(async () => {
  "use server"
  return loadHomePage()
}, "getEmbedHomeData")

/**
 * A section's share card on its own, for an iframe on another site (share/embed.ts). It plays the card's animation
 * when it scrolls into view and rests on the finished card, silently, and opens the section on OpenCode Data when
 * clicked.
 */
export default function Embed() {
  const params = useParams()
  const location = useLocation()
  const event = getRequestEvent()
  if (event) {
    setStatsPageCacheHeaders(event.response.headers)
    // Any site may frame an embed; nothing else on /data opts in.
    event.response.headers.set("Content-Security-Policy", "frame-ancestors *")
    event.response.headers.set("X-Robots-Tag", "noindex")
  }
  const embed = createMemo(() => readEmbed(params.section ?? "", new URLSearchParams(location.search)))
  const data = createAsync(() => getData())
  // A fixed embed's card, from the URL's fragment, which only the browser sees. Until it's been read, draw nothing,
  // so a fixed embed never flashes the live numbers first.
  const [fixed, setFixed] = createSignal<ShareCard>()
  const [read, setRead] = createSignal(false)
  onMount(() => {
    const packed = new URLSearchParams(window.location.hash.slice(1)).get("card")
    if (!packed) return setRead(true)
    void unpackCard(packed)
      .then(setFixed)
      .catch(() => undefined)
      .finally(() => setRead(true))
  })
  const card = createMemo<ShareCard | undefined>(() => {
    if (fixed()) return fixed()
    const section = embed().section
    const value = data()
    if (!section || !value) return undefined
    const draft = homeShareCard(section, value, embed().view)
    return draft && { ...draft, updatedAt: value.updatedAt, url: "opencode.ai/data" }
  })
  const title = () => shareTitles[embed().section ?? "top-models"]
  const oembed = () =>
    `${baseUrl}/data/oembed?format=json&url=${encodeURIComponent(`${baseUrl}${location.pathname}${location.search}`)}`

  let canvas: HTMLCanvasElement | undefined
  createEffect(() => {
    const value = card()
    const options = embed().options
    const target = canvas
    if (!target || !value || !read()) return
    const ctx = target.getContext("2d")
    if (!ctx) return
    target.width = shareSizes[options.size][0]
    target.height = shareSizes[options.size][1]
    const still = () => drawShareCard(ctx, value, options, Infinity)
    let frame = 0
    let cancelled = false
    onCleanup(() => {
      cancelled = true
      cancelAnimationFrame(frame)
    })
    void loadShareFonts().then(() => {
      if (cancelled) return
      still()
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
      // The animation plays each time the card comes into view and stops, on the finished card, when it leaves.
      const length = mainLength(value, options)
      const play = () => {
        const start = performance.now()
        const tick = () => {
          const time = (performance.now() - start) / 1000
          if (time >= length) return still()
          drawShareCard(ctx, value, options, time)
          frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      }
      const observer = new IntersectionObserver(([entry]) => {
        cancelAnimationFrame(frame)
        if (entry?.isIntersecting) return play()
        still()
      })
      observer.observe(target)
      onCleanup(() => observer.disconnect())
    })
  })

  return (
    <main data-page="embed">
      <Title>{`${title()} · OpenCode Data`}</Title>
      <Meta name="robots" content="noindex" />
      <Link rel="alternate" type="application/json+oembed" href={oembed()} title={title()} />
      <Show when={embed().section} fallback={<p data-slot="embed-missing">This embed doesn't exist.</p>}>
        {(section) => (
          <a
            href={`${baseUrl}/data/#${section()}`}
            target="_blank"
            rel="noopener"
            aria-label={`${title()} on OpenCode Data`}
          >
            <canvas
              ref={canvas}
              role="img"
              aria-label={card()?.headline ?? title()}
              style={{
                "aspect-ratio": `${shareSizes[embed().options.size][0]} / ${shareSizes[embed().options.size][1]}`,
              }}
            />
          </a>
        )}
      </Show>
    </main>
  )
}
