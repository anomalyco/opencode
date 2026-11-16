import "./products-arrows.css"
import { onCleanup, onMount } from "solid-js"
import { useI18n } from "~/context/i18n"
import { CarouselArrows } from "./carousel-arrows"
import { carouselNav } from "./carousel-nav"

/**
 * The products carousel's previous and next, for a mouse, whose wheel can't scroll the cards
 * sideways: hidden until the page's code finds the cards overflow (carousel-nav.ts), and never shown
 * on touch screens (products-arrows.css), which swipe.
 */
export default function ProductsArrows(props: { track: string }) {
  const i18n = useI18n()
  let nav!: HTMLDivElement
  onMount(() => {
    const track = document.getElementById(props.track)
    if (track) onCleanup(carouselNav(nav, track))
  })
  return (
    <div data-slot="carousel-nav" ref={nav} hidden>
      <CarouselArrows
        previous={i18n.t("site.products.previous")}
        next={i18n.t("site.products.next")}
        controls={props.track}
      />
    </div>
  )
}
