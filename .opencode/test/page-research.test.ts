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
      lists: [],
      tables: [],
    },
    links: [
      { text: "Home", url: "https://example.test/", rel: [], external: false },
      { text: "Again", url: "https://example.test/", rel: [], external: false },
      { text: "Docs", url: "https://docs.example.test", rel: [], external: true },
    ],
    images: [],
    videos: [],
    metadata: {
      description: null,
      keywords: "test, crawler",
      author: "Test Author",
      published_time: "2024-01-15",
      modified_time: "2024-06-20",
      og: { title: "OG Title", description: null, image: null, type: "article", site_name: "Example", url: null },
      twitter: { card: "summary", title: null, description: null, image: null, site: "@example" },
    },
    structured_data: [],
    breadcrumbs: [],
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

  test("renders language and canonical URL when present", () => {
    const digest = formatPageResearch(makeResult())
    expect(digest).toContain("Language: en")
    expect(digest).toContain("Canonical URL: https://example.test/article")
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
      makeResult({ content: { text: big, headings: [], paragraphs: [], lists: [], tables: [] } }),
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
      content: { text: "Only text.", headings: [], paragraphs: [], lists: [], tables: [] },
      links: [],
      metadata: {},
      structured_data: [],
      breadcrumbs: [],
    })
    const digest = formatPageResearch(bare)
    expect(digest).toContain("== MAIN CONTENT ==")
    expect(digest).not.toContain("== HEADINGS ==")
    expect(digest).not.toContain("== LINKS ==")
    expect(digest).not.toContain("== METADATA ==")
    expect(digest).not.toContain("== STRUCTURED DATA")
    expect(digest).not.toContain("== BREADCRUMBS ==")
    expect(digest).toContain("Only text.")
  })

  test("lists non-null metadata pairs only", () => {
    const digest = formatPageResearch(makeResult())
    expect(digest).toContain("- keywords: test, crawler")
    expect(digest).toContain("- author: Test Author")
    expect(digest).toContain("- published_time: 2024-01-15")
    expect(digest).toContain("- modified_time: 2024-06-20")
    expect(digest).toContain("- og:title: OG Title")
    expect(digest).toContain("- og:site_name: Example")
    expect(digest).toContain("- og:type: article")
    expect(digest).toContain("- twitter:card: summary")
    expect(digest).toContain("- twitter:site: @example")
  })

  test("renders tables when present", () => {
    const result = makeResult({
      content: {
        text: "Table content.",
        headings: [],
        paragraphs: [],
        lists: [],
        tables: [
          { headers: ["Name", "Price"], rows: [["Widget", "$10"], ["Gadget", "$20"]] },
        ],
      },
    })
    const digest = formatPageResearch(result)
    expect(digest).toContain("== TABLES ==")
    expect(digest).toContain("Table 1:")
    expect(digest).toContain("Headers: Name | Price")
    expect(digest).toContain("Widget | $10")
    expect(digest).toContain("Gadget | $20")
  })

  test("renders lists when present", () => {
    const result = makeResult({
      content: {
        text: "List content.",
        headings: [],
        paragraphs: [],
        lists: [
          { text: "Item 1", level: 0, nested: [] },
          { text: "Item 2", level: 0, nested: [{ text: "Nested A", level: 1 }] },
        ],
        tables: [],
      },
    })
    const digest = formatPageResearch(result)
    expect(digest).toContain("== LISTS ==")
    expect(digest).toContain("- Item 1")
    expect(digest).toContain("- Item 2")
    expect(digest).toContain("  - Nested A")
  })

  test("renders images and videos when present", () => {
    const result = makeResult({
      images: [
        { src: "https://example.test/logo.png", alt: "Logo", title: "Company Logo" },
        { src: "https://example.test/photo.jpg", alt: null, title: null },
      ],
      videos: [
        { src: "https://www.youtube.com/embed/abc123", title: "Demo Video", poster: null, type: "iframe" },
      ],
    })
    const digest = formatPageResearch(result)
    expect(digest).toContain("== MEDIA ==")
    expect(digest).toContain("Images (2):")
    expect(digest).toContain("- https://example.test/logo.png [alt: Logo] (title: Company Logo)")
    expect(digest).toContain("- https://example.test/photo.jpg")
    expect(digest).toContain("Videos (1):")
    expect(digest).toContain("- https://www.youtube.com/embed/abc123 [iframe]")
  })

  test("renders structured data when present", () => {
    const result = makeResult({
      structured_data: [
        {
          type: "Article",
          name: "Test Article",
          data: { "@type": "Article", "name": "Test Article", "author": { "@type": "Person", "name": "John" } },
        },
      ],
    })
    const digest = formatPageResearch(result)
    expect(digest).toContain("== STRUCTURED DATA (JSON-LD) ==")
    expect(digest).toContain("[Article] — Test Article")
    expect(digest).toContain("author:")
  })

  test("caps structured data items with count", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      type: "Thing",
      name: `Item ${i}`,
      data: { "@type": "Thing", "name": `Item ${i}` },
    }))
    const digest = formatPageResearch(makeResult({ structured_data: many }), { maxStructuredData: 5 })
    expect(digest).toContain("[... 20 more structured data items truncated]")
  })

  test("renders breadcrumbs when present", () => {
    const result = makeResult({
      breadcrumbs: [
        { text: "Home", url: "https://example.test/" },
        { text: "Products", url: "https://example.test/products" },
        { text: "Widget", url: null },
      ],
    })
    const digest = formatPageResearch(result)
    expect(digest).toContain("== BREADCRUMBS ==")
    expect(digest).toContain("Home > Products > Widget")
  })

  test("preserves Unicode characters in all rendered fields", () => {
    const digest = formatPageResearch(
      makeResult({
        page: { title: "R\u00e9sum\u00e9 \u25bc\u00a9 Guide", description: null, language: "en", canonical_url: null },
        content: { text: "Caf\u00e9 \u2615 \u2014 \u201Cquoted\u201D", headings: [{ level: 1, text: "\u00dCber" }], paragraphs: [], lists: [], tables: [] },
      }),
    )
    expect(digest).toContain("R\u00e9sum\u00e9 \u25bc\u00a9 Guide")
    expect(digest).toContain("Caf\u00e9 \u2615 \u2014 \u201Cquoted\u201D")
    expect(digest).toContain("- [h1] \u00dCber")
  })

  test("reports missing extracted text explicitly", () => {
    const digest = formatPageResearch(makeResult({ content: { text: "", headings: [], paragraphs: [], lists: [], tables: [] } }))
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
    "page": {"title": "Flow Page \\u25bc", "description": None, "language": "en", "canonical_url": url},
    "content": {
        "text": "Deep \\u25bc content",
        "headings": [{"level": 1, "text": "H"}],
        "paragraphs": ["p"],
        "lists": [{"text": "Item A", "level": 0}],
        "tables": [{"headers": ["Col1"], "rows": [["Val1"]]}],
    },
    "links": [{"text": "n", "url": url + "/next", "rel": [], "external": False}],
    "images": [{"src": url + "/img.png", "alt": "logo", "title": None}],
    "videos": [],
    "metadata": {
        "description": None,
        "keywords": None,
        "author": "Flow Author",
        "published_time": "2024-03-01",
        "modified_time": None,
        "og": {"title": None, "description": None, "image": None, "type": None, "site_name": "Stub", "url": None},
        "twitter": {"card": "summary", "title": None, "description": None, "image": None, "site": None},
    },
    "structured_data": [{"type": "WebPage", "name": "Flow Page", "data": {"@type": "WebPage", "name": "Flow Page"}}],
    "breadcrumbs": [{"text": "Home", "url": url}],
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
    expect(digest).toContain("Language: en")
    expect(digest).toContain("Canonical URL: https://flow.example/page")
    expect(digest).toContain("== TABLES ==")
    expect(digest).toContain("Headers: Col1")
    expect(digest).toContain("Val1")
    expect(digest).toContain("== LISTS ==")
    expect(digest).toContain("- Item A")
    expect(digest).toContain("== STRUCTURED DATA")
    expect(digest).toContain("[WebPage] — Flow Page")
    expect(digest).toContain("== BREADCRUMBS ==")
    expect(digest).toContain("Home")
    expect(digest).toContain("- author: Flow Author")
    expect(digest).toContain("- published_time: 2024-03-01")
    expect(digest).toContain("- twitter:card: summary")
  })
})
