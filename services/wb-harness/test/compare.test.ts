import { describe, expect, test } from "bun:test"
import { extractOffers, formatOffersForContext, rankOffers } from "../src/tools/compare"

describe("extractOffers", () => {
  test("reads two offers with prices and quantities", () => {
    const parsed = extractOffers("Что дешевле: 2 за 300 ₽ или 4 за 400 ₽?")

    expect(parsed?.offers).toHaveLength(2)
    expect(parsed?.offers.map((offer) => offer.priceRub)).toEqual([300, 400])
    expect(parsed?.offers.map((offer) => offer.quantity)).toEqual([2, 4])
  })

  test("detects grams as a unit", () => {
    const parsed = extractOffers("Кофе 100 г за 250 ₽ или 250 г за 600 ₽")

    expect(parsed?.unit).toBe("gram")
    expect(parsed?.offers).toHaveLength(2)
  })

  test("returns undefined for a single offer", () => {
    expect(extractOffers("Сколько стоит 1 за 300 ₽?")).toBeUndefined()
  })

  test("ignores text without prices", () => {
    expect(extractOffers("Найди мне кроссовки Nike")).toBeUndefined()
  })
})

describe("rankOffers", () => {
  test("sorts by rising price per unit", () => {
    const ranked = rankOffers([
      { name: "набор", priceRub: 400, quantity: 4 },
      { name: "двойка", priceRub: 300, quantity: 2 },
    ])

    expect(ranked.map((offer) => offer.name)).toEqual(["набор", "двойка"])
    expect(ranked[0]?.rubPerUnit).toBe(100)
  })

  test("formats a readable context block", () => {
    const ranked = rankOffers([
      { name: "набор", priceRub: 400, quantity: 4 },
      { name: "двойка", priceRub: 300, quantity: 2 },
    ])
    const text = formatOffersForContext("piece", ranked)

    expect(text).toContain("Самое выгодное: набор")
    expect(text).toContain("100 ₽/шт.")
  })
})
