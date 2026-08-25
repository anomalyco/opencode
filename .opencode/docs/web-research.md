# Web Research Workflow

Agent-facing crawling workflow built on the Scrapling integration
(`lib/scrapling-crawler.ts` → local Python `crawler_cli.py`, process-isolated).

## Tools

### `research-page` — recommended for research tasks

Crawls one URL and returns a **research digest**: main content (capped),
heading outline, deduplicated links, non-null metadata — plus the full
structured `CrawlResult` under `metadata.crawl`.

| Arg | Required | Default | Notes |
|-----|----------|---------|-------|
| `url` | yes | — | http/https only, validated before spawn |
| `mode` | no | `stealth` | `http` (plain requests) · `stealth` (anti-bot, JS-rendered) · `browser` (Playwright, JS-rendered) |
| `focus` | no | — | Research instruction echoed into the digest to steer agent reasoning |

Summarizing, answering questions and field extraction are performed by the
agent reasoning over the digest — the tool never calls an LLM itself.

### `crawler` — raw structured access

Same crawl path, returns the complete JSON payload unchanged. Use when the
agent needs machine-exact fields rather than a digest.

## Example interaction

> **User:** "What license does https://example.repo use? Use the browser mode."
>
> **Agent:** calls `research-page` with
> `{ url: "https://example.repo", mode: "browser", focus: "identify the software license" }`
> then answers from the digest's MAIN CONTENT / METADATA sections.

## Failure modes (typed `CrawlerError.kind`)

`invalid-url` · `config` (missing python/script) · `spawn` · `timeout` ·
`encoding` (non-UTF-8 stdout) · `protocol` (empty/non-JSON stdout) ·
`failure` (`success=false` from crawler). Errors carry a bounded stderr tail;
stdout JSON is never contaminated by logs.

## Configuration

- `SCRAPLING_PYTHON` — override python executable
  (default `C:/projects/crawler/.venv/Scripts/python.exe`; Unix: `.venv/bin/python`)
- `CRAWLER_PATH` — override `crawler_cli.py` location

## Application API

Programmatic use case on top of the tool (used by apps and the demo):

```ts
import { researchPage } from "./lib/research-app"

const finding = await researchPage({
  url: "https://quotes.toscrape.com/js/",
  mode: "browser",                       // stealth | browser | http
  objective: "List each quote author",
})
// finding: { requestedUrl, title, finalUrl, httpStatus, ok, fetchMode,
//   mainContent, headings, paragraphs, links, images, metadata,
//   crawlerError, objective, digest }
```

- Invokes the `research-page` tool internally; consumes its structured
  `metadata.crawl` directly (never as an opaque text blob).
- Non-2xx pages return findings with `ok: false`; hard failures throw typed
  `CrawlerError` (`invalid-url`, `config`, `spawn`, `timeout`, `encoding`,
  `protocol`, `failure`).
- Live demo: `bun examples/research-demo.ts`

## Tests

```bash
cd .opencode && bun test
```
