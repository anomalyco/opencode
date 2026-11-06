import { anomalyProducts } from "~/component/site/links"

/** Anomaly's other apps' English copy, by app. */
export const appsSource = Object.fromEntries(
  anomalyProducts.map((app) => [app.id, { category: app.category, body: app.body }]),
) as Record<(typeof anomalyProducts)[number]["id"], { category: string; body: string }>
