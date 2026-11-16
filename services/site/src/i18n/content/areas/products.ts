import { allProductPages, extensions, type PageSlug } from "~/component/site/product-data"

/** The product cards' English copy: each product page's card, and the extensions card. */
export const productsSource = Object.fromEntries(
  allProductPages.map((product) => [product.slug, { name: product.name, body: product.body, action: product.action }]),
) as Record<PageSlug, { name: string; body: string; action: string }>

export const extensionCardSource = { name: extensions.name, body: extensions.body, action: extensions.action }
