import { Marked } from "~/component/site/marked"
import { useI18n } from "~/context/i18n"
import "./media-gallery.css"
import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { fanMotion } from "~/component/site/logo-fan"
import type { PressMediaItem } from "~/lib/press-content"
import { Still } from "~/component/site/media"
import { inlineKey, scrollLeftFor, scrollStart } from "~/lib/direction"

type Product = {
  name: string
  slug: string
  zip: { href: string; size: string }
  items: PressMediaItem[]
}

type Style = "products" | "strip" | "thumbnails" | "filmstrip" | "grid" | "wall" | "fan"

/**
 * The press media, one group per product, in one of seven layouts (Settings › Press media layout).
 * Every layout opens the same lightbox: arrow keys move through the product's media, Escape closes,
 * focus stays inside, and each still or video downloads from there.
 */
export function MediaGallery(props: { products: Product[]; style: Style }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal<{ product: number; item: number; from: HTMLElement }>()
  const show = (product: number, item: number, event: MouseEvent) =>
    setOpen({ product, item, from: event.currentTarget as HTMLElement })

  return (
    <div data-component="press-gallery" data-style={props.style}>
      <For each={props.products}>
        {(product, productIndex) => (
          <Show
            when={props.style !== "products"}
            fallback={
              // "products" (default): one column per product with its name and count, one
              // representative image (the product film's poster) that opens the lightbox on all of
              // the product's media, and one Download all button. No per-item actions.
              <section data-slot="group" aria-label={i18n.t("press.ui.media", { name: product.name })}>
                <div data-slot="group-head">
                  <h3>{product.name}</h3>
                  <span data-slot="count">{i18n.t("press.ui.items", { count: product.items.length })}</span>
                </div>
                <Thumb item={product.items[0]} onClick={(event) => show(productIndex(), 0, event)} />
                <a
                  href={product.zip.href}
                  download={`opencode-${product.slug}-media.zip`}
                  data-slot="product-download"
                  data-variant="neutral"
                  data-component="site-button"
                >
                  <Marked text={i18n.t("press.ui.downloadAll", { name: product.name })} slots={{ sr: "sr-only" }} />
                  <span data-slot="size">{product.zip.size}</span>
                  <DownloadIcon />
                </a>
                {/* In a narrow column the size moves out of the button to a muted line under it. */}
                <span data-slot="zip-size" aria-hidden="true">
                  ZIP, {product.zip.size}
                </span>
              </section>
            }
          >
            <section data-slot="group" aria-label={i18n.t("press.ui.media", { name: product.name })}>
              <div data-slot="group-head">
                <h3>{product.name}</h3>
                <span data-slot="count">{i18n.t("press.ui.items", { count: product.items.length })}</span>
                <a
                  href={product.zip.href}
                  download={`opencode-${product.slug}-media.zip`}
                  data-slot="group-download"
                  data-variant="neutral"
                  data-component="site-button"
                >
                  <Marked text={i18n.t("press.ui.downloadAll", { name: product.name })} slots={{ sr: "sr-only" }} />
                  <span data-slot="size">{product.zip.size}</span>
                  <DownloadIcon />
                </a>
              </div>
              <Switch>
                <Match when={props.style === "strip"}>
                  <Strip product={product} onOpen={(item, event) => show(productIndex(), item, event)} />
                </Match>
                <Match when={props.style === "thumbnails"}>
                  <Thumbnails product={product} onOpen={(item, event) => show(productIndex(), item, event)} />
                </Match>
                <Match when={props.style === "filmstrip"}>
                  <Filmstrip product={product} onOpen={(item, event) => show(productIndex(), item, event)} />
                </Match>
                <Match when={props.style === "fan"}>
                  <Fan product={product} onOpen={(item, event) => show(productIndex(), item, event)} />
                </Match>
                <Match when={true}>
                  <ul data-slot="tiles">
                    <For each={product.items}>
                      {(item, index) => (
                        <li data-orientation={item.height > item.width ? "portrait" : "landscape"}>
                          <Thumb item={item} onClick={(event) => show(productIndex(), index(), event)} />
                        </li>
                      )}
                    </For>
                  </ul>
                </Match>
              </Switch>
            </section>
          </Show>
        )}
      </For>
      <Show when={open()}>
        {(state) => (
          <Lightbox
            product={props.products[state().product]}
            index={state().item}
            onIndex={(item) => setOpen({ ...state(), item })}
            onClose={() => {
              const from = state().from
              setOpen(undefined)
              from.focus()
            }}
          />
        )}
      </Show>
    </div>
  )
}

// The thumbnails are drawn at most 385px wide: their copies (media.tsx) are 800px.
const thumbSizes = "385px"

/** A thumbnail button; videos carry a small play mark. */
function Thumb(props: { item: PressMediaItem; onClick: (event: MouseEvent) => void; current?: boolean }) {
  const i18n = useI18n()
  return (
    <button
      type="button"
      data-slot="thumb"
      data-kind={props.item.kind}
      aria-current={props.current ? "true" : undefined}
      onClick={(event) => props.onClick(event)}
    >
      <Still
        src={props.item.thumb}
        sizes={thumbSizes}
        alt=""
        width={props.item.width}
        height={props.item.height}
        loading="lazy"
        decoding="async"
      />
      <Show when={props.item.kind === "video"}>
        <span data-slot="play" aria-hidden="true">
          <PlayIcon />
        </span>
      </Show>
      <span data-slot="sr-only">
        {i18n.t(props.item.kind === "video" ? "press.ui.openVideo" : "press.ui.open", { title: props.item.title })}
      </span>
    </button>
  )
}

/** A thumbnail with its caption, then its downloads and a copy-link icon. */
function Tile(props: {
  item: PressMediaItem
  copied: boolean
  onOpen: (event: MouseEvent) => void
  onCopy: () => void
}) {
  const i18n = useI18n()
  const file = (src: string) => src.split("/").pop() ?? src
  return (
    <>
      <Thumb item={props.item} onClick={props.onOpen} />
      <div data-slot="tile-meta">
        <span data-slot="caption-text">{props.item.title}</span>
        <div data-slot="tile-actions">
          <a href={props.item.image} download={file(props.item.image)} data-slot="tile-action">
            <Marked
              text={i18n.t("press.ui.fileOf", { format: "JPG", title: props.item.title })}
              slots={{ sr: "sr-only" }}
            />
            <DownloadIcon />
          </a>
          <Show when={props.item.video}>
            {(video) => (
              <a href={video()} download={file(video())} data-slot="tile-action">
                <Marked
                  text={i18n.t("press.ui.fileOf", { format: "MP4", title: props.item.title })}
                  slots={{ sr: "sr-only" }}
                />
                <DownloadIcon />
              </a>
            )}
          </Show>
          <button
            type="button"
            data-slot="tile-action"
            data-tip={i18n.t("changelog.share.copy")}
            data-tip-align="center"
            aria-label={i18n.t("press.ui.copyLinkTo", { title: props.item.title })}
            onClick={props.onCopy}
          >
            <Show when={props.copied} fallback={<CopyIcon />}>
              <CheckIcon />
            </Show>
          </button>
        </div>
      </div>
    </>
  )
}

/** Copies an item's absolute link and marks it as copied for a moment. */
function useCopyLink() {
  const [copied, setCopied] = createSignal<string>()
  const copy = (item: PressMediaItem) => {
    void navigator.clipboard.writeText(new URL(item.video ?? item.image, location.href).href)
    setCopied(item.id)
    setTimeout(() => setCopied((current) => (current === item.id ? undefined : current)), 1500)
  }
  return { copied, copy }
}

/**
 * "strip" (default): one row of small thumbnails per product, no big image. It scrolls sideways
 * (swipe, trackpad, the arrow buttons, or ←/→ between thumbnails) and snaps to each thumbnail; the
 * edges fade where there is more to scroll. A thumbnail opens the lightbox.
 */
function Strip(props: { product: Product; onOpen: (item: number, event: MouseEvent) => void }) {
  const i18n = useI18n()
  const link = useCopyLink()
  const [edges, setEdges] = createSignal({ start: true, end: false })
  let track!: HTMLUListElement
  const measure = () =>
    setEdges({
      start: scrollStart(track) <= 1,
      end: scrollStart(track) + track.clientWidth >= track.scrollWidth - 1,
    })
  onMount(() => {
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    onCleanup(() => observer.disconnect())
  })
  const page = (direction: 1 | -1) =>
    track.scrollBy({ left: scrollLeftFor(track, direction * track.clientWidth * 0.8), behavior: "smooth" })
  // ←/→ move focus between thumbnails, scrolling the next one into view.
  const keys = (event: KeyboardEvent) => {
    const key = inlineKey(event)
    if (key !== "ArrowRight" && key !== "ArrowLeft") return
    const thumbs = [...track.querySelectorAll<HTMLElement>('[data-slot="thumb"]')]
    const index = thumbs.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    event.preventDefault()
    const next = thumbs[Math.min(thumbs.length - 1, Math.max(0, index + (key === "ArrowRight" ? 1 : -1)))]
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
  }
  return (
    <div
      data-slot="strip-carousel"
      data-at-start={edges().start ? "" : undefined}
      data-at-end={edges().end ? "" : undefined}
    >
      <ul ref={track} data-slot="strip-track" onScroll={measure} onKeyDown={keys}>
        <For each={props.product.items}>
          {(item, index) => (
            <li>
              <Tile
                item={item}
                copied={link.copied() === item.id}
                onOpen={(event) => props.onOpen(index(), event)}
                onCopy={() => link.copy(item)}
              />
            </li>
          )}
        </For>
      </ul>
      <button
        type="button"
        data-slot="strip-arrow"
        data-direction="previous"
        disabled={edges().start}
        onClick={() => page(-1)}
      >
        <span aria-hidden="true">←</span>
        <span data-slot="sr-only">{i18n.t("press.ui.previousMedia", { name: props.product.name })}</span>
      </button>
      <button
        type="button"
        data-slot="strip-arrow"
        data-direction="next"
        disabled={edges().end}
        onClick={() => page(1)}
      >
        <span aria-hidden="true">→</span>
        <span data-slot="sr-only">{i18n.t("press.ui.nextMedia", { name: props.product.name })}</span>
      </button>
      <span data-slot="sr-only" aria-live="polite">
        {link.copied() ? i18n.t("site.action.copied") : ""}
      </span>
    </div>
  )
}

/**
 * "thumbnails": uniform 16:9 cover-cropped thumbnails in a grid, each with its caption, downloads
 * and a copy-link icon under it. A thumbnail opens the lightbox.
 */
function Thumbnails(props: { product: Product; onOpen: (item: number, event: MouseEvent) => void }) {
  const i18n = useI18n()
  const link = useCopyLink()
  return (
    <ul data-slot="thumbnails">
      <For each={props.product.items}>
        {(item, index) => (
          <li>
            <Tile
              item={item}
              copied={link.copied() === item.id}
              onOpen={(event) => props.onOpen(index(), event)}
              onCopy={() => link.copy(item)}
            />
          </li>
        )}
      </For>
      <li data-slot="sr-only" aria-live="polite">
        {link.copied() ? i18n.t("site.action.copied") : ""}
      </li>
    </ul>
  )
}

/** A big preview of the chosen item over a strip of every item; the preview opens the lightbox. */
function Filmstrip(props: { product: Product; onOpen: (item: number, event: MouseEvent) => void }) {
  const i18n = useI18n()
  const [current, setCurrent] = createSignal(0)
  const item = () => props.product.items[current()]
  return (
    <div data-slot="filmstrip">
      <button
        type="button"
        data-slot="preview"
        data-kind={item().kind}
        onClick={(event) => props.onOpen(current(), event)}
      >
        <img src={item().image} alt="" width={item().width} height={item().height} loading="lazy" decoding="async" />
        <Show when={item().kind === "video"}>
          <span data-slot="play" aria-hidden="true">
            <PlayIcon />
          </span>
        </Show>
        <span data-slot="caption">{item().title}</span>
        <span data-slot="sr-only">Open {item().title} larger</span>
      </button>
      <ul data-slot="strip">
        <For each={props.product.items}>
          {(entry, index) => (
            <li data-orientation={entry.height > entry.width ? "portrait" : "landscape"}>
              <Thumb item={entry} current={index() === current()} onClick={() => setCurrent(index())} />
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

/**
 * A stacked deck of the product's media. Opening it fans the cards out into a grid with the logo
 * fan's spring, stagger and lifted shadows; each card then opens the lightbox.
 */
function Fan(props: { product: Product; onOpen: (item: number, event: MouseEvent) => void }) {
  const i18n = useI18n()
  const [fanned, setFanned] = createSignal(false)
  let deck!: HTMLButtonElement
  let grid!: HTMLUListElement
  const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

  createEffect(
    on(
      fanned,
      (open) => {
        if (!open || still()) return
        const origin = deck.getBoundingClientRect()
        const cards = [...grid.children] as HTMLElement[]
        cards.forEach((card, index) => {
          const box = card.getBoundingClientRect()
          // Each card springs out from the deck's place, one after another.
          const dx = origin.left + origin.width / 2 - (box.left + box.width / 2)
          const dy = origin.top + origin.height / 2 - (box.top + box.height / 2)
          const turn = ((index % 3) - 1) * 4
          const timing = { delay: index * fanMotion.stagger, fill: "backwards" as const }
          card.animate(
            [{ transform: `translate(${dx}px, ${dy}px) rotate(${turn}deg) scale(0.6)` }, { transform: fanMotion.rest }],
            { ...timing, duration: 520, easing: fanMotion.spring },
          )
          card.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, duration: 140, easing: "ease-out" })
          card.toggleAttribute("data-lift", true)
          setTimeout(() => card.removeAttribute("data-lift"), timing.delay + 260)
        })
      },
      { defer: true },
    ),
  )

  return (
    <div data-slot="fan" data-open={fanned() ? "" : undefined}>
      <button
        ref={deck}
        type="button"
        data-slot="deck"
        aria-expanded={fanned() ? "true" : "false"}
        onClick={() => setFanned(!fanned())}
      >
        <span data-slot="cards" aria-hidden="true">
          <For each={props.product.items.slice(0, 4).toReversed()}>
            {(item, index) => (
              <Still
                src={item.thumb}
                sizes={thumbSizes}
                alt=""
                width={item.width}
                height={item.height}
                loading="lazy"
                style={{ "--card": 3 - index() }}
              />
            )}
          </For>
        </span>
        <span data-slot="deck-label">
          <Marked
            text={
              fanned()
                ? i18n.t("press.ui.stack", { name: props.product.name })
                : i18n.t("press.ui.fanOut", { count: props.product.items.length, name: props.product.name })
            }
            slots={{ sr: "sr-only" }}
          />
        </span>
      </button>
      <Show when={fanned()}>
        <ul ref={grid} data-slot="fanned">
          <For each={props.product.items}>
            {(item, index) => (
              <li data-orientation={item.height > item.width ? "portrait" : "landscape"}>
                <Thumb item={item} onClick={(event) => props.onOpen(index(), event)} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

/** The enlarged item, with the previous and next items, downloads and a close button. */
function Lightbox(props: { product: Product; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const i18n = useI18n()
  let root!: HTMLDivElement
  const item = () => props.product.items[props.index]
  const count = () => props.product.items.length
  const step = (by: number) => props.onIndex((props.index + by + count()) % count())
  const file = (src: string) => src.split("/").pop() ?? src

  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") return props.onClose()
    if (inlineKey(event) === "ArrowRight") return step(1)
    if (inlineKey(event) === "ArrowLeft") return step(-1)
    if (event.key !== "Tab") return
    // Keep focus inside the lightbox.
    const focusable = [...root.querySelectorAll<HTMLElement>("button, a[href], video[controls]")]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  createEffect(() => {
    document.addEventListener("keydown", keys)
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = "hidden"
    root.querySelector<HTMLElement>('[data-slot="close"]')?.focus()
    onCleanup(() => {
      document.removeEventListener("keydown", keys)
      document.documentElement.style.overflow = overflow
    })
  })

  // Rendered in place (not in a portal) so the site's button styles still apply; it is fixed to the window.
  return (
    <div
      ref={root}
      data-component="press-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={i18n.t("press.ui.media", { name: props.product.name })}
      onClick={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div data-slot="stage">
        <Show
          when={item().video}
          keyed
          fallback={<img src={item().image} alt={item().title} width={item().width} height={item().height} />}
        >
          {(video) => (
            <video
              src={video}
              poster={item().image}
              width={item().width}
              height={item().height}
              controls
              autoplay
              muted
              loop
              playsinline
              aria-label={item().title}
            />
          )}
        </Show>
      </div>
      <div data-slot="bar">
        <p data-slot="title">
          {item().title}
          <span data-slot="counter">
            {props.index + 1} / {count()}
          </span>
        </p>
        <div data-slot="actions">
          <button type="button" data-component="site-button" data-variant="neutral" onClick={() => step(-1)}>
            <span aria-hidden="true">←</span>
            <span data-slot="sr-only">{i18n.t("press.ui.previous")}</span>
          </button>
          <button type="button" data-component="site-button" data-variant="neutral" onClick={() => step(1)}>
            <span aria-hidden="true">→</span>
            <span data-slot="sr-only">{i18n.t("press.ui.next")}</span>
          </button>
          <a href={item().image} download={file(item().image)} data-component="site-button" data-variant="neutral">
            <Marked
              text={i18n.t("press.ui.fileOf", { format: "JPG", title: item().title })}
              slots={{ sr: "sr-only" }}
            />
            <DownloadIcon />
          </a>
          <Show when={item().video}>
            {(video) => (
              <a href={video()} download={file(video())} data-component="site-button" data-variant="neutral">
                <Marked
                  text={i18n.t("press.ui.fileOf", { format: "MP4", title: item().title })}
                  slots={{ sr: "sr-only" }}
                />
                <DownloadIcon />
              </a>
            )}
          </Show>
          <button type="button" data-slot="close" data-component="site-button" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
      <span data-slot="sr-only" aria-live="polite">
        {item().title}, {props.index + 1} of {count()}
      </span>
    </div>
  )
}

function CopyIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7.5 7.5V3.75H16.25V12.5H12.5M3.75 7.5H12.5V16.25H3.75V7.5Z" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 10.5L8.25 14.25L15.5 6" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.5V10.5L10.5 6L3 1.5Z" fill="currentColor" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="square"
      />
    </svg>
  )
}
