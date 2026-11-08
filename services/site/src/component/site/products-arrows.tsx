import "./products-arrows.css"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { CarouselArrows } from "./carousel-arrows"
import { prefersReducedMotion } from "./products"

/**
 * The products carousel's previous and next, for a mouse, whose wheel can't scroll the cards
 * sideways. ProductCarousel loads this only on a fine pointer once the cards overflow, so touch
 * screens and screens wide enough for every card never download it. Shown while the cards overflow,
 * each end disabled once the cards reach it.
 */
export default function ProductsArrows(props: { track: HTMLElement }) {
  const i18n = useI18n()
  const [scrolled, setScrolled] = createSignal<{ start: boolean; end: boolean }>()
  const track = props.track
  track.id ||= "products-track"
  const measure = () => {
    const max = track.scrollWidth - track.clientWidth
    const at = Math.abs(track.scrollLeft)
    setScrolled(max > 1 ? { start: at < 2, end: at > max - 2 } : undefined)
  }
  // By as many whole cards as fit (at least one); the snap lines them up.
  const page = (direction: 1 | -1) => {
    const card = track.firstElementChild
    if (!(card instanceof HTMLElement)) return
    const style = getComputedStyle(track)
    const step = card.offsetWidth + (parseFloat(style.columnGap) || 0)
    const cards = Math.max(1, Math.floor(track.clientWidth / step))
    track.scrollBy({
      left: direction * (style.direction === "rtl" ? -1 : 1) * step * cards,
      behavior: prefersReducedMotion() ? "instant" : "smooth",
    })
  }
  onMount(() => {
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(track)
    track.addEventListener("scroll", measure, { passive: true })
    onCleanup(() => {
      resize.disconnect()
      track.removeEventListener("scroll", measure)
    })
  })
  return (
    <Show when={scrolled()}>
      {(edges) => (
        <div data-slot="carousel-nav">
          <CarouselArrows
            previous={i18n.t("site.products.previous")}
            next={i18n.t("site.products.next")}
            controls={track.id}
            atStart={edges().start}
            atEnd={edges().end}
            onPrevious={() => page(-1)}
            onNext={() => page(1)}
          />
        </div>
      )}
    </Show>
  )
}
