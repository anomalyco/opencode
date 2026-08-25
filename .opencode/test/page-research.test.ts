import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

import type { ScraplingCrawlResult } from "../lib/scrapling-crawler"
import { crawlWithScrapling } from "../lib/scrapling-crawler"
import { formatPageResearch } from "../lib/page-research"

function makeResult(overrides: Partial<ScraplingCrawlResult> = {}): ScraplingCrawlResult {
  return {
    success: true,
    request: { url: "https://example.test/article", fetch_mode: "stealth" },
    response: { status_code: 200, final_url: "https://example.test/article", content_type: "text/html", response_time_ms: 5 },
    page: { title: "Test Article", description: "A test page", language: "en", canonical_url: "https://example.test/article" },
    content: {
      text: "Main body text.",
      headings: [
        { level: 1, text: "Intro" },
        { level: 2, text: "Details" },
      ],
      paragraphs: ["Main body text."],
    },
    links: [
      { text: "Home", url: "https://example.test/", rel: [], external: false },
      { text: "Again", url: "https://example.test/", rel: [], external: false },
      { text: "Docs", url: "https://docs.example.test", rel: [], external: true },
    ],
    images: [],
    metadata: {
      description: null,
      keywords: "test, crawler",
      og: { title: "OG Title", description: null, image: null, type: null, site_name: "Example", url: null },
      twitter: { card: null, title: null, description: null, image: null, site: null },
    },
    error: null,
    ...overrides,
  }
}

describe("formatPageResearch", () => {
  test("renders header block with url, mode, status, title and description", () => {
    const digest = formatPageResearch(makeResult())
    expect(digest).toContain("WEB PAGE RESEARCH")
    expect(digest).toContain("URL: https://example.test/article (stealth)")
    expect(digest).toContain("HTTP status: 200")
    expect(digest).toContain("Title: Test Article")
    expect(digest).toContain("Description: A test page")
  })

  test("flags non-200 statuses as potentially error pages", () => {
    const digest = formatPageResearch(makeResult({ response: { status_code: 404, final_url: null, content_type: "text/html", response_time_ms: 5 } }))
    expect(digest).toContain("HTTP status: 404 (non-OK response")
  })

  test("echoes the research focus only when provided", () => {
    const without = formatPageResearch(makeResult())
    const withFocus = formatPageResearch(makeResult(), { focus: "extract pricing fields" })
    expect(without).not.toContain("Research focus:")
    expect(withFocus).toContain("Research focus: extract pricing fields")
  })

  test("truncates oversized main content and reports the cut", () => {
    const big = "x".repeat(500)
    const digest = formatPageResearch(
      makeResult({ content: { text: big, headings: [], paragraphs: [] } }),
      { maxContentChars: 100 },
    )
    expect(digest).toContain("[... truncated 400 of 500 chars")
    expect(digest.indexOf("[... truncated")).toBeGreaterThan(digest.indexOf("== MAIN CONTENT =="))
  })

  test("deduplicates links and caps the list with counts", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      text: `L${i}`,
      url: `https://example.test/${i}`,
      rel: [],
      external: false,
    }))
    many.push({ text: "Dup", url: "https://example.test/0", rel: [], external: false })
    const digest = formatPageResearch(makeResult({ links: many }), { maxLinks: 10 })
    expect(digest).toContain("== LINKS == (showing 10 of 60 unique)")
    expect(digest).toContain("- L9 -> https://example.test/9")
    expect(digest).not.toContain("- L10 ->")
  })

  test("omits empty heading/link/metadata sections", () => {
    const bare = makeResult({
      content: { text: "Only text.", headings: [], paragraphs: [] },
      links: [],
      metadata: {},
    })
    const digest = formatPageResearch(bare)
    expect(digest).toContain("== MAIN CONTENT ==")
    expect(digest).not.toContain("== HEADINGS ==")
    expect(digest).not.toContain("== LINKS ==")
    expect(digest).not.toContain("== METADATA ==")
    expect(digest).toContain("Only text.")
  })

  test("lists non-null metadata pairs only", () => {
    const digest = formatPageResearch(makeResult())
    expect(digest).toContain("- keywords: test, crawler")
    expect(digest).toContain("- og:title: OG Title")
    expect(digest).toContain("- og:site_name: Example")
    expect(digest).not.toContain("og:description:")
    expect(digest).not.toContain("twitter:card:")
  })

  test("preserves Unicode characters in all rendered fields", () => {
    const digest = formatPageResearch(
      makeResult({
        page: { title: "Résumé ▼© Guide", description: null, language: "en", canonical_url: null },
        content: { text: "Café ☕ — “quoted”", headings: [{ level: 1, text: "Über" }], paragraphs: [] },
      }),
    )
    expect(digest).toContain("Résumé ▼© Guide")
    expect(digest).toContain("Café ☕ — “quoted”")
    expect(digest).toContain("- [h1] Über")
  })

  test("reports missing extracted text explicitly", () => {
    const digest = formatPageResearch(makeResult({ content: { text: "", headings: [], paragraphs: [] } }))
    expect(digest).toContain("(no text extracted)")
  })
})

describe("page-research flow via scrapling client", () => {
  const VENV_PYTHON = "C:/projects/crawler/.venv/Scripts/python.exe"
  let stubDir: string
  let saved: Record<string, string | undefined> = {}

  const STUB = `
import json, sys
url = sys.argv[1]
mode = sys.argv[3] if len(sys.argv) > 3 else "http"
payload = {
    "success": True,
    "request": {"url": url, "fetch_mode": mode},
    "response": {"status_code": 200, "final_url": url, "content_type": "text/html", "response_time_ms": 1},
    "page": {"title": "Flow Page ▼", "description": None, "language": "en", "canonical_url": url},
    "content": {"text": "Deep \\u25bc content", "headings": [{"level": 1, "text": "H"}], "paragraphs": ["p"]},
    "links": [{"text": "n", "url": url + "/next", "rel": [], "external": False}],
    "images": [],
    "metadata": {"og": {"site_name": "Stub"}},
    "error": None,
}
sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
`

  beforeAll(async () => {
    stubDir = await mkdtemp(path.join(tmpdir(), "research-stub-"))
    await writeFile(path.join(stubDir, "stub.py"), STUB, "utf-8")
    for (const key of ["SCRAPLING_PYTHON", "PYTHON_PATH", "CRAWLER_PATH"]) {
      saved[key] = process.env[key]
    }
    process.env.SCRAPLING_PYTHON = VENV_PYTHON
    process.env.CRAWLER_PATH = path.join(stubDir, "stub.py").replace(/\\/g, "/")
  })

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(stubDir, { recursive: true, force: true })
  })

  test("crawls through the client and formats a complete digest", async () => {
    const result = await crawlWithScrapling({
      url: "https://flow.example/page",
      mode: "browser",
    })
    const digest = formatPageResearch(result, { focus: "answer: what is this page about?" })
    expect(digest).toContain("Title: Flow Page ▼")
    expect(digest).toContain("Deep ▼ content")
    expect(digest).toContain("Research focus: answer: what is this page about?")
    expect(digest).toContain("(browser)")
    expect(digest).toContain("-> https://flow.example/page/next")
    expect(digest).toContain("- og:site_name: Stub")
  })
})
