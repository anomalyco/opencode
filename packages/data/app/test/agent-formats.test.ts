import { describe, expect, test } from "bun:test"
import { formatPeriodDate } from "../src/lib/format"
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

describe("period dates", () => {
  test("a day shows one date", () => {
    expect(formatPeriodDate("2026-11-20", "2026-11-20")).toBe("Nov 20, 2026")
  })

  test("a week shows its range, across months and years", () => {
    expect(formatPeriodDate("2026-11-16", "2026-11-20")).toBe("Nov 16 – 20, 2026")
    expect(formatPeriodDate("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027")
  })
})
