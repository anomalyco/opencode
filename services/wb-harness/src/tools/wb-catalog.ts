export type CatalogProduct = {
  id: number
  name: string
  brand?: string
  priceRub?: number
  rating?: number
  feedbacks?: number
  url: string
}

const searchHosts = [
  "https://search.wb.ru/exactmatch/ru/common/v13/search",
  "https://search.wb.ru/exactmatch/ru/common/v9/search",
]

const defaultParams = {
  appType: "1",
  curr: "rub",
  dest: "-1257786",
  lang: "ru",
  resultset: "catalog",
  spp: "30",
}

export async function searchProducts(
  query: string,
  signal: AbortSignal,
  limit = 5,
): Promise<CatalogProduct[]> {
  const errors: string[] = []
  for (const host of searchHosts) {
    const url = new URL(host)
    for (const [key, value] of Object.entries(defaultParams)) url.searchParams.set(key, value)
    url.searchParams.set("query", query)
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("page", "1")

    try {
      const response = await fetch(url, {
        signal,
        headers: {
          origin: "https://www.wildberries.ru",
          referer: "https://www.wildberries.ru/",
          "user-agent": "Mozilla/5.0",
        },
      })
      if (!response.ok) {
        errors.push(`${url.host} ${response.status}`)
        continue
      }
      const payload = (await response.json()) as unknown
      const products = readProducts(payload)
      if (products.length) return products
    } catch (error) {
      errors.push(`${url.host} ${error instanceof Error ? error.message : "failed"}`)
    }
  }
  throw new Error(`catalog search unavailable (${errors.join("; ")})`)
}

export async function productDetails(
  article: string,
  signal: AbortSignal,
): Promise<CatalogProduct | undefined> {
  const url = new URL("https://card.wb.ru/cards/v2/detail")
  url.searchParams.set("appType", "1")
  url.searchParams.set("curr", "rub")
  url.searchParams.set("dest", "-1257786")
  url.searchParams.set("spp", "30")
  url.searchParams.set("nm", article)

  const response = await fetch(url, {
    signal,
    headers: {
      origin: "https://www.wildberries.ru",
      referer: "https://www.wildberries.ru/",
      "user-agent": "Mozilla/5.0",
    },
  })
  if (!response.ok) throw new Error(`card endpoint ${response.status}`)
  return readProducts(await response.json())[0]
}

export function productURL(id: number): string {
  return `https://www.wildberries.ru/catalog/${id}/detail.aspx`
}

function readProducts(payload: unknown): CatalogProduct[] {
  const products = readPath(payload, ["data", "products"]) ?? readPath(payload, ["products"])
  if (!Array.isArray(products)) return []

  return products.flatMap((raw) => {
    if (!isRecord(raw)) return []
    const id = typeof raw.id === "number" ? raw.id : Number(raw.id)
    if (!Number.isFinite(id)) return []
    const name = typeof raw.name === "string" ? raw.name : `Артикул ${id}`
    const brand = typeof raw.brand === "string" ? raw.brand : undefined
    return [
      {
        id,
        name,
        brand,
        priceRub: readPrice(raw),
        rating: typeof raw.reviewRating === "number" ? raw.reviewRating : undefined,
        feedbacks: typeof raw.feedbacks === "number" ? raw.feedbacks : undefined,
        url: productURL(id),
      },
    ]
  })
}

function readPrice(raw: Record<string, unknown>): number | undefined {
  const sizes = Array.isArray(raw.sizes) ? raw.sizes : []
  for (const size of sizes) {
    if (!isRecord(size)) continue
    const price = isRecord(size.price) ? size.price : undefined
    if (!price) continue
    const total = price.total ?? price.product ?? price.basic
    if (typeof total === "number" && total > 0) return normalizeKopecks(total)
  }
  const salePrice = isRecord(raw.salePriceU) ? undefined : raw.salePriceU
  if (typeof salePrice === "number" && salePrice > 0) return normalizeKopecks(salePrice)
  return
}

/** WB price fields are kopecks; older payloads already come in rubles. */
function normalizeKopecks(value: number): number {
  return value >= 10000 ? value / 100 : value
}

function readPath(payload: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) return
    return current[key]
  }, payload)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function formatProducts(products: CatalogProduct[]): string {
  return products
    .map((product) => {
      const price = product.priceRub ? `${product.priceRub.toFixed(0)} ₽` : "цена не указана"
      const brand = product.brand ? `${product.brand} ` : ""
      const rating =
        product.rating && product.feedbacks
          ? `, рейтинг ${product.rating.toFixed(1)} (${product.feedbacks} отзывов)`
          : ""
      return `- ${brand}${product.name} — ${price}${rating}; ${product.url}`
    })
    .join("\n")
}
