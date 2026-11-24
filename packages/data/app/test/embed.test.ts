import { describe, expect, test } from "bun:test"
import { defaultShareOptions, type ShareCard } from "../src/share/card"
import { embedSize, embedSnippet, embedUrl, packCard, readEmbed, unpackCard } from "../src/share/embed"

const card: ShareCard & { view: { period: "daily"; leaderboard: "weekly" } } = {
  id: "top-models",
  title: "Top Models",
  range: "Past 55 days",
  highlight: "DeepSeek V4.1 Flash",
  headline: "DeepSeek V4.1 Flash led OpenCode usage in the past 7 days, with 29T tokens",
  stat: { value: "29T", label: "tokens for DeepSeek V4.1 Flash, in the past 7 days" },
  updatedAt: "2026-11-24T00:10:00.000Z",
  url: "opencode.ai/data",
  view: { period: "daily", leaderboard: "weekly" },
  chart: {
    kind: "stacked",
    normalized: false,
    series: [{ key: "deepseek-v4.1-flash", label: "deepseek-v4.1-flash", color: "#ed6aff", value: "29T" }],
    columns: [{ label: "Nov 23", values: [29.1] }],
    total: { label: "All models, Nov 23", value: "44T" },
  },
}

describe("embed urls", () => {
  test("an embed's URL reads back as the card's section, options and view", () => {
    const url = embedUrl("https://opencode.ai/data/", card, { ...defaultShareOptions, size: "16:9", theme: "light" })
    expect(url.pathname).toBe("/data/embed/top-models")
    const read = readEmbed("top-models", url.searchParams)
    expect(read.section).toBe("top-models")
    expect(read.options).toEqual({ ...defaultShareOptions, size: "16:9", theme: "light" })
    expect(read.view).toEqual({ period: "daily", leaderboard: "weekly" })
  })

  test("unknown sections and values fall back instead of failing", () => {
    const read = readEmbed("nope", new URLSearchParams("size=3:2&style=neon&period=yearly"))
    expect(read.section).toBeUndefined()
    expect(read.options).toEqual(defaultShareOptions)
    expect(read.view).toEqual({ period: "weekly", leaderboard: "weekly" })
  })

  test("the snippet keeps the size's shape and caps its width", () => {
    const html = embedSnippet("https://opencode.ai/data/embed/retention", "Weekly Retention", "9:16")
    expect(html).toContain("aspect-ratio:1080/1920")
    expect(html).toContain("max-width:405px")
    expect(embedSize("16:9", 480)).toEqual({ width: 480, height: 270 })
  })
})

describe("fixed embeds", () => {
  test("a card survives the trip through the URL fragment", async () => {
    const packed = await packCard(card)
    expect(packed).toMatch(/^[\w-]+$/)
    expect(await unpackCard(packed)).toEqual(card)
  })
})
