import { extractOffers, formatOffersForContext, rankOffers } from "./compare"
import { registerTool, runTool, toolsForText, type ToolResult } from "./registry"
import { formatProducts, productDetails, productURL, searchProducts } from "./wb-catalog"

export type Enrichment = {
  tools: string[]
  results: ToolResult[]
  context: string
}

const articlePattern = /\b(\d{5,15})\b/
const linkIntent = /ссылк|карточк|артикул|страниц/i
const searchIntent = /найд|поиск|покажи|подбер|посоветуй|какие есть|сколько стоит/i
const detailsIntent = /цен|стоит|характеристик|подробн|отзыв/i

export function registerShoppingTools() {
  registerTool({
    name: "wb_product_link",
    description: "Returns the Wildberries product page URL for a numeric article ID.",
    match: (text) => {
      const article = text.match(articlePattern)?.[1]
      if (!article || !linkIntent.test(text)) return
      return { article }
    },
    run: async (args) => {
      const article = String(args.article)
      const url = productURL(Number(article))
      return {
        tool: "wb_product_link",
        ok: true,
        summary: `Карточка товара с артикулом ${article}: ${url}`,
        artifacts: [url],
      }
    },
  })

  registerTool({
    name: "wb_compare_unit_prices",
    description: "Ranks offers by price per unit using prices and quantities from the user text.",
    match: (text) => {
      const parsed = extractOffers(text)
      if (!parsed) return
      return parsed as unknown as Record<string, unknown>
    },
    run: async (args) => {
      const unit = String(args.unit) as "piece" | "gram" | "milliliter" | "meter"
      const offers = args.offers as Array<{ name: string; priceRub: number; quantity: number }>
      const ranked = rankOffers(offers)
      return {
        tool: "wb_compare_unit_prices",
        ok: true,
        summary: formatOffersForContext(unit, ranked),
        artifacts: [],
        data: { unit, ranked },
      }
    },
  })

  registerTool({
    name: "wb_search_products",
    description: "Searches the Wildberries catalog by text query and returns top products.",
    match: (text) => {
      if (articlePattern.test(text) && linkIntent.test(text)) return
      if (!searchIntent.test(text)) return
      const query = stripIntentWords(text)
      if (query.length < 3) return
      return { query }
    },
    run: async (args, context) => {
      const query = String(args.query)
      const products = await searchProducts(query, context.signal)
      return {
        tool: "wb_search_products",
        ok: true,
        summary: `Найдено в каталоге по запросу «${query}»:\n${formatProducts(products)}`,
        artifacts: products.map((product) => product.url),
        data: products,
      }
    },
  })

  registerTool({
    name: "wb_product_details",
    description: "Fetches Wildberries product details for a known article ID.",
    match: (text) => {
      const article = text.match(articlePattern)?.[1]
      if (!article || !detailsIntent.test(text)) return
      return { article }
    },
    run: async (args, context) => {
      const article = String(args.article)
      const product = await productDetails(article, context.signal)
      if (!product) throw new Error(`товар ${article} не найден`)
      return {
        tool: "wb_product_details",
        ok: true,
        summary: `Данные товара:\n${formatProducts([product])}`,
        artifacts: [product.url],
        data: product,
      }
    },
  })
}

function stripIntentWords(text: string): string {
  return text
    .replace(/\b(найди|найти|поиск|покажи|подбери|посоветуй|какие есть|сколько стоит|цена|купить)\b/gi, " ")
    .replace(/[?!.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export async function enrich(text: string, timeoutMs: number): Promise<Enrichment> {
  const matches = toolsForText(text)
  if (!matches.length) return { tools: [], results: [], context: "" }

  const signal = AbortSignal.timeout(timeoutMs)
  const results = await Promise.all(
    matches.map(({ tool, args }) => runTool(tool, args, { signal, timeoutMs })),
  )

  const successful = results.filter((result) => result.ok)
  const context = successful.length
    ? [
        "Справочные сведения, которые можно использовать в ответе:",
        ...successful.map((result) => result.summary),
      ].join("\n\n")
    : ""

  return { tools: matches.map((match) => match.tool.name), results, context }
}

export function buildPrompt(text: string, enrichment: Enrichment): string {
  if (!enrichment.context) return text
  return `${enrichment.context}\n\nВопрос покупателя: ${text}`
}
