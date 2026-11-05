import { ProductPage } from "~/component/site/product-page"
import { productAreas } from "~/component/site/product-data"
import { productChangelog } from "~/lib/changelog"

// Hovering or focusing a link here (a carousel card, say) starts loading the page's changelog.
export const route = { preload: () => productChangelog(productAreas.terminal!) }

export default function Page() {
  return <ProductPage slug="terminal" />
}
