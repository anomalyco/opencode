import { describe, expect, test } from "bun:test"
import { translate } from "../src/i18n"
import { packCard, unpackCard } from "../src/share/embed"
import { retentionCard } from "../src/share/sections"

describe("plural forms", () => {
  test("a word agrees with its count in the locale's plural rules", () => {
    expect(translate("en", "share.range.pastDays", { count: 1 })).toBe("Past 1 day")
    expect(translate("en", "share.range.pastDays", { count: 55 })).toBe("Past 55 days")
    expect(translate("ru", "share.range.pastDays", { count: 21 })).toBe("Последний 21 день")
    expect(translate("ru", "share.range.pastDays", { count: 3 })).toBe("Последние 3 дня")
    expect(translate("ru", "share.range.pastDays", { count: 55 })).toBe("Последние 55 дней")
    expect(translate("ja", "share.range.pastDays", { count: 55 })).toBe("過去55日間")
  })
})

describe("share cards", () => {
  test("a card is written in the language it's made in", () => {
    const retention = [{ model: "glm-5", name: "GLM-5", rate: 61.2 }] as Parameters<typeof retentionCard>[1]
    const card = retentionCard("de", retention)
    expect(card?.locale).toBe("de")
    expect(card?.title).toBe("Wöchentliche Nutzerbindung")
    expect(card?.headline).toBe("GLM-5 hielt 61.2% seiner OpenCode-Nutzer von einer Woche zur nächsten")
  })

  test("a fixed embed in a language it can't read is drawn in English", async () => {
    const card = retentionCard("fr", [{ model: "glm-5", name: "GLM-5", rate: 61.2 }] as Parameters<
      typeof retentionCard
    >[1])!
    const packed = await packCard({ ...card, locale: "xx" as "en", updatedAt: null, url: "opencode.ai/data" })
    expect((await unpackCard(packed)).locale).toBe("en")
  })
})
