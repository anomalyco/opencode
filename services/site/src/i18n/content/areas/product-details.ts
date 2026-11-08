import { productDetails, type PageSlug } from "~/component/site/product-data"

/** The product pages' English copy, by product. */
export const productDetailsSource = Object.fromEntries(
  Object.entries(productDetails).map(([slug, detail]) => [
    slug,
    {
      title: detail.title,
      description: detail.description,
      intro: detail.intro,
      features: detail.features.map((feature) => ({ title: feature.title, body: feature.body })),
      showcase: detail.showcase.map((row) => ({ title: row.title, body: row.body })),
    },
  ]),
) as Record<
  PageSlug,
  {
    title: string
    description: string
    intro: string
    features: { title: string; body: string }[]
    showcase: { title: string; body: string }[]
  }
>
