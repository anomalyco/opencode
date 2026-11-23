import { allProductPages, type PageSlug } from "~/component/site/product-data"
import { productDownloads } from "~/lib/download-content"

/** Each product page's Download section in English, with plain paths (pages localize their own links). */
export const productDownloadsSource = Object.fromEntries(
  allProductPages.map((product) => [product.slug, productDownloads(product.slug, (path) => path)]),
) as Record<PageSlug, ReturnType<typeof productDownloads>>
