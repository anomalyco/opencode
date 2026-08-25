import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

import { CrawlerError, researchPage } from "../lib/research-app"

// Application-layer tests: run the real researchPage() use case against a
// stub crawler script so every branch is deterministic and offline.

const VENV_PYTHON = "C:/projects/crawler/.venv/Scripts/python.exe"

const STUB = `
import json, sys
url = sys.argv[1]
mode = sys.argv[3] if len(sys.argv) > 3 else "http"

def emit(payload, code=0):
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.write(b"\\n")
    sys.exit(code)

def success(status=200, title="Stub Page"):
    return {
        "success": True,
        "request": {"url": url, "fetch_mode": mode},
        "response": {"status_code": status, "final_url": url + "/final", "content_type": "text/html", "response_time_ms": 2},
        "page": {"title": title, "description": "Stub description", "language": "en", "canonical_url": url},
        "content": {
            "text": "Café ☕ body — “quoted” \\u25bc",
            "headings": [{"level": 1, "text": "Top"}],
            "paragraphs": ["para one"],
        },
        "links": [{"text": "next", "url": url + "/next", "rel": [], "external": False}],
        "images": [{"src": url + "/img.png", "alt": "logo", "title": None}],
        "metadata": {
            "description": "Meta description",
            "keywords": None,
            "og": {"title": "OG T", "description": None, "image": None, "type": None, "site_name": "StubCo", "url": None},
            "twitter": {"card": None, "title": None, "description": None, "image": None, "site": None},
        },
        "error": None,
    }

if "good.example" in url:
    emit(success())
elif "unicode.example" in url:
    emit(success(title="Résumé ▼©"))
elif "notfound.example" in url:
    emit(success(status=404))
else:
    emit(success())
`

let saved: Record<string, string | undefined>
let stubDir: string

beforeAll(async () => {
  stubDir = await mkdtemp(path.join(tmpdir(), "app-stub-"))
  await writeFile(path.join(stubDir, "stub.py"), STUB, "utf-8")
  saved = {}
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

describe("researchPage application use case", () => {
  test("successful scrape returns an organized structured finding", async () => {
    const f = await researchPage({ url: "https://good.example/page" })
    expect(f.title).toBe("Stub Page")
    expect(f.finalUrl).toBe("https://good.example/page/final")
    expect(f.httpStatus).toBe(200)
    expect(f.ok).toBe(true)
    expect(f.mainContent).toContain("body")
    expect(f.headings).toEqual([{ level: 1, text: "Top" }])
    expect(f.paragraphs).toEqual(["para one"])
    expect(f.links[0]).toEqual({ text: "next", url: "https://good.example/page/next", external: false })
    expect(f.images[0]).toEqual({ src: "https://good.example/page/img.png", alt: "logo" })
    expect(f.metadata.description).toBe("Meta description")
    expect(f.metadata.ogSiteName).toBe("StubCo")
    expect(f.metadata.keywords).toBeNull()
    expect(f.crawlerError).toBeNull()
    expect(f.digest).toContain("== MAIN CONTENT ==")
  })

  test("structured output exposes the complete documented shape", async () => {
    const f = await researchPage({ url: "https://good.example/page" })
    for (const key of [
      "requestedUrl", "title", "finalUrl", "httpStatus", "ok", "fetchMode",
      "mainContent", "headings", "paragraphs", "links", "images", "metadata",
      "crawlerError", "objective", "digest",
    ]) {
      expect(f).toHaveProperty(key)
    }
  })

  test("stealth mode passes through and is reported in the finding", async () => {
    const f = await researchPage({ url: "https://good.example/page", mode: "stealth" })
    expect(f.fetchMode).toBe("stealth")
  })

  test("browser mode passes through (JS-rendered pages)", async () => {
    const f = await researchPage({
      url: "https://good.example/js",
      mode: "browser",
      objective: "list items",
    })
    expect(f.fetchMode).toBe("browser")
    expect(f.objective).toBe("list items")
    expect(f.digest).toContain("Research focus: list items")
  })

  test("non-200 responses return findings with ok=false instead of throwing", async () => {
    const f = await researchPage({ url: "https://notfound.example/x" })
    expect(f.httpStatus).toBe(404)
    expect(f.ok).toBe(false)
    expect(f.title).toBe("Stub Page")
  })

  test("malformed/invalid input is rejected cleanly with a typed error", async () => {
    const err = await researchPage({ url: "not-a-url" }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("invalid-url")

    const ftp = await researchPage({ url: "ftp://example.com" }).catch((e) => e)
    expect((ftp as CrawlerError).kind).toBe("invalid-url")
  })

  test("Unicode is preserved across all finding fields", async () => {
    const f = await researchPage({ url: "https://unicode.example/a" })
    expect(f.title).toBe("Résumé ▼©")
    expect(f.mainContent).toContain("Café ☕")
    expect(f.mainContent).toContain("“quoted”")
    expect(f.mainContent).toContain("▼")
  })

  test("objective is carried into the finding and digest", async () => {
    const f = await researchPage({
      url: "https://good.example/page",
      objective: "extract pricing fields",
    })
    expect(f.objective).toBe("extract pricing fields")
    expect(f.digest).toContain("Research focus: extract pricing fields")
  })
})
