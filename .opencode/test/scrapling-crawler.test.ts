import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

import { CrawlerError, crawlWithScrapling } from "../lib/scrapling-crawler"

// Offline tests for the Scrapling client protocol handling. A stub Python
// script stands in for crawler_cli.py and emits canned responses keyed off
// the requested URL, so every failure branch is deterministic and no real
// network is touched.

const VENV_PYTHON = "C:/projects/crawler/.venv/Scripts/python.exe"

const STUB = `
import json, sys, time

url = sys.argv[1]
args = sys.argv[2:]
mode = args[args.index("--mode") + 1] if "--mode" in args else "http"

def emit(payload, code=0):
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.write(b"\\n")
    sys.stdout.buffer.flush()
    sys.exit(code)

def success(url=url, status=200, title="Stub Title"):
    return {
        "success": True,
        "request": {"url": url, "fetch_mode": mode},
        "response": {"status_code": status, "final_url": url, "content_type": "text/html", "response_time_ms": 1.0},
        "page": {"title": title, "description": None, "language": "en", "canonical_url": url},
        "content": {"text": "body \\u25bc \\u00a9 text", "headings": [{"level": 1, "text": "H"}], "paragraphs": ["p1"], "lists": [], "tables": []},
        "links": [{"text": "next", "url": url + "/2", "rel": [], "external": False}],
        "images": [],
        "videos": [],
        "metadata": {},
        "structured_data": [],
        "breadcrumbs": [],
        "error": None,
    }

if "good.example" in url:
    emit(success())
elif "unicode.example" in url:
    emit(success(title="Unicode \\u25bc\\u00a9 Title"))
elif "notfound.example" in url:
    emit(success(status=404))
elif "badjson.example" in url:
    sys.stdout.write("{oops")
elif "empty.example" in url:
    pass
elif "fail.example" in url:
    emit({"success": False, "error": {"type": "FetchError", "message": "site unreachable"}}, code=1)
elif "slow.example" in url:
    time.sleep(10)
    emit(success())
elif "binary.example" in url:
    sys.stdout.buffer.write(b"\\xff\\xfe\\x00broken")
else:
    emit(success())
`

let stubDir: string
let stubPath: string
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  stubDir = await mkdtemp(path.join(tmpdir(), "crawler-stub-"))
  stubPath = path.join(stubDir, "stub_crawler.py").replace(/\\/g, "/")
  await writeFile(stubPath, STUB, "utf-8")
})

afterAll(async () => {
  await rm(stubDir, { recursive: true, force: true })
})

function useStub(python: string) {
  process.env.SCRAPLING_PYTHON = python
  process.env.CRAWLER_PATH = stubPath
}

beforeEach(() => {
  for (const key of ["SCRAPLING_PYTHON", "PYTHON_PATH", "CRAWLER_PATH"]) {
    savedEnv[key] = process.env[key]
  }
  useStub(VENV_PYTHON)
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("crawlWithScrapling", () => {
  test("parses structured JSON and preserves Unicode", async () => {
    const result = await crawlWithScrapling({ url: "https://unicode.example/page" })
    expect(result.success).toBe(true)
    expect(result.page?.title).toBe("Unicode ▼© Title")
    expect(result.content?.text).toContain("▼")
    expect(result.content?.text).toContain("©")
    expect(result.links?.[0]?.url).toBe("https://unicode.example/page/2")
  })

  test("passes the selected mode through to the crawler", async () => {
    const stealth = await crawlWithScrapling({ url: "https://good.example", mode: "stealth" })
    const browser = await crawlWithScrapling({ url: "https://good.example", mode: "browser" })
    expect(stealth.request?.fetch_mode).toBe("stealth")
    expect(browser.request?.fetch_mode).toBe("browser")
  })

  test("passes non-200 statuses through as structured results", async () => {
    const result = await crawlWithScrapling({ url: "https://notfound.example/x" })
    expect(result.success).toBe(true)
    expect(result.response?.status_code).toBe(404)
  })

  test("rejects non-http URLs before spawning anything", async () => {
    for (const bad of ["ftp://example.com/file", "not-a-url", "javascript:alert(1)"]) {
      const err = await crawlWithScrapling({ url: bad }).catch((e) => e)
      expect(err).toBeInstanceOf(CrawlerError)
      expect((err as CrawlerError).kind).toBe("invalid-url")
    }
  })

  test("malformed JSON on stdout fails cleanly with stderr tail attached", async () => {
    const err = await crawlWithScrapling({ url: "https://badjson.example" }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("protocol")
    expect((err as CrawlerError).message).toContain("{oops")
  })

  test("invalid UTF-8 on stdout fails with encoding kind", async () => {
    const err = await crawlWithScrapling({ url: "https://binary.example" }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("encoding")
  })

  test("empty stdout fails with protocol kind", async () => {
    const err = await crawlWithScrapling({ url: "https://empty.example" }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("protocol")
    expect((err as CrawlerError).message).toContain("empty stdout")
  })

  test("success=false surfaces the crawler error details", async () => {
    const err = await crawlWithScrapling({ url: "https://fail.example" }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("failure")
    expect((err as CrawlerError).message).toContain("FetchError")
    expect((err as CrawlerError).message).toContain("site unreachable")
  })

  test("kills slow crawlers on timeout", async () => {
    const err = await crawlWithScrapling({
      url: "https://slow.example",
      timeoutMs: 800,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("protocol")
    expect((err as CrawlerError).message).toMatch(/empty stdout/)
  }, 15_000)

  test("missing python executable reports a config error", async () => {
    useStub("Z:/definitely/not/a/python.exe")
    const err = await crawlWithScrapling({ url: "https://good.example" }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("config")
    expect((err as CrawlerError).message).toContain("Python executable not found")
  })

  test("non-executable python path reports a spawn error", async () => {
    useStub(stubDir) // exists but cannot be spawned
    const err = await crawlWithScrapling({ url: "https://good.example" }).catch((e) => e)
    expect(err).toBeInstanceOf(CrawlerError)
    expect((err as CrawlerError).kind).toBe("spawn")
  })
})
