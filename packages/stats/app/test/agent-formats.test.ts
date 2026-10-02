import { describe, expect, test } from "bun:test"
import { isoDay } from "../src/lib/format"
import { jsonUrl, markdownUrl, prefersMarkdown } from "../src/lib/language"

describe("markdown negotiation", () => {
  test("agents that list markdown first get markdown", () => {
    expect(prefersMarkdown("text/markdown, text/html, */*")).toBe(true)
    expect(prefersMarkdown("text/x-markdown, */*")).toBe(true)
    expect(prefersMarkdown("text/markdown;q=0.9, text/html;q=0.8")).toBe(true)
  })

  test("browsers and html-first clients get html", () => {
    expect(prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false)
    expect(prefersMarkdown("text/html, text/markdown;q=0.5")).toBe(false)
    expect(prefersMarkdown("*/*")).toBe(false)
    expect(prefersMarkdown(null)).toBe(false)
  })
})

describe("agent format urls", () => {
  test("the home page maps to index files", () => {
    expect(markdownUrl("/data/")).toBe("https://opencode.ai/data/index.md")
    expect(jsonUrl("/data")).toBe("https://opencode.ai/data/index.json")
  })

  test("other pages append the extension", () => {
    expect(markdownUrl("/data/deepseek")).toBe("https://opencode.ai/data/deepseek.md")
    expect(jsonUrl("/data/deepseek/deepseek-v4-1-flash")).toBe(
      "https://opencode.ai/data/deepseek/deepseek-v4-1-flash.json",
    )
  })
})

describe("iso days", () => {
  test("series labels resolve against the update time", () => {
    expect(isoDay("Aug 7", "2026-10-01T22:16:22.000Z")).toBe("2026-08-07")
    expect(isoDay("Oct 1", "2026-10-01T22:16:22.000Z")).toBe("2026-10-01")
  })

  test("labels from December stay in the previous year after New Year", () => {
    expect(isoDay("Dec 30", "2027-01-02T08:00:00.000Z")).toBe("2026-12-30")
    expect(isoDay("Jan 2", "2027-01-02T08:00:00.000Z")).toBe("2027-01-02")
  })

  test("unrecognized labels pass through", () => {
    expect(isoDay("Week 32", "2026-10-01T22:16:22.000Z")).toBe("Week 32")
  })
})
