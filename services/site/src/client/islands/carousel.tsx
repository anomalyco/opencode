import ProductsArrows from "~/component/site/products-arrows"
import { $ } from "../dom"
import { mount } from "../solid"

/**
 * The home carousel's previous and next (products-arrows.tsx), for a mouse (home.ts loads this only
 * on a fine pointer), whose wheel can't scroll the cards sideways: rendered in the browser once the
 * cards overflow, so windows wide enough for every card never show them.
 */
export default function carousel(section: HTMLElement) {
  const track = $('[data-slot="track"]', section)
  if (!track) return
  const check = () => {
    if (track.scrollWidth - track.clientWidth < 2) return
    removeEventListener("resize", check)
    void mount(() => <ProductsArrows track={track} />, section)
  }
  addEventListener("resize", check)
  check()
}
