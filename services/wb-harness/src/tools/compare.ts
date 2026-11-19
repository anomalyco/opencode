export type Unit = "piece" | "gram" | "milliliter" | "meter"

export type Offer = {
  name: string
  priceRub: number
  quantity: number
}

export type RankedOffer = Offer & { rubPerUnit: number }

const unitLabels: Record<Unit, string> = {
  piece: "шт.",
  gram: "г",
  milliliter: "мл",
  meter: "м",
}

export function rankOffers(offers: Offer[]): RankedOffer[] {
  return offers
    .map((offer) => ({ ...offer, rubPerUnit: offer.priceRub / offer.quantity }))
    .sort((left, right) => left.rubPerUnit - right.rubPerUnit)
}

export function formatRanking(unit: Unit, ranked: RankedOffer[]): string {
  const label = unitLabels[unit]
  return ranked
    .map(
      (offer, index) =>
        `${index + 1}. ${offer.name}: ${formatRub(offer.priceRub)} за ${offer.quantity} ${label} = ${formatRub(offer.rubPerUnit)}/${label}`,
    )
    .join("\n")
}

function formatRub(value: number): string {
  return `${value.toFixed(2).replace(/\.00$/, "")} ₽`
}

const quantityPricePattern =
  /(\d+(?:[.,]\d+)?)\s*([^\s,;.\d]{0,12})?\s*(?:за|по|\/)\s*(\d+(?:[.,]\d+)?)\s*(?:₽|руб\.?|р\.?)/iu

/**
 * Extracts "quantity for price" offers from free text, e.g. "2 за 300 ₽".
 * Returns undefined when fewer than two comparable offers are found.
 */
export function extractOffers(text: string): { unit: Unit; offers: Offer[] } | undefined {
  const offers: Offer[] = []
  let unit: Unit | undefined

  for (const clause of text.split(/или|,|;|\s+vs\.?\s+/i)) {
    const match = clause.match(quantityPricePattern)
    if (!match) continue

    const quantity = Number(match[1]?.replace(",", "."))
    const price = Number(match[3]?.replace(",", "."))
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price <= 0) continue

    const detected = normalizeUnit(match[2])
    if (detected && !unit) unit = detected

    const name = cleanName(clause.slice(0, match.index ?? 0)) || `${quantity} ${unitLabels[detected ?? "piece"]}`
    offers.push({ name, priceRub: price, quantity })
  }

  if (offers.length < 2) return
  return { unit: unit ?? "piece", offers }
}

function cleanName(value: string): string {
  return value
    .replace(/\b(что|сколько|дешевле|дороже|выгоднее|лучше|цена|вариант)\b/gi, " ")
    .replace(/[:\-—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeUnit(raw: string | undefined): Unit | undefined {
  if (!raw) return
  const value = raw.toLowerCase().replace(/[.\s]/g, "")
  if (value.startsWith("мл")) return "milliliter"
  if (value.startsWith("метр") || value === "м") return "meter"
  if (value.startsWith("г")) return "gram"
  if (value.startsWith("шт") || value.startsWith("штук")) return "piece"
}

export function formatOffersForContext(unit: Unit, ranked: RankedOffer[]): string {
  const label = unitLabels[unit]
  const best = ranked[0]
  if (!best) return `Сравнение предложений по цене за единицу (${label}): нет данных`
  return [
    `Сравнение предложений по цене за единицу (${label}):`,
    formatRanking(unit, ranked),
    `Самое выгодное: ${best.name} — ${formatRub(best.rubPerUnit)} за ${label}`,
  ].join("\n")
}
