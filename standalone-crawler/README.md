# Standalone Scrapling Crawler (Phase 1)

A production-ready, **standalone** single-page web crawler built on the
[Scrapling](https://github.com/D4Vinci/Scrapling) library. It fetches one
supplied URL, extracts structured content, and returns machine-readable JSON.

This is **Phase 1 only**. It has no dependency on OpenCode, MCP, any
external AI agent, or any search API — see [Future Integration](#future-integration).

---

## Overview

Given a URL, the crawler:

1. Validates the URL (http/https only).
2. Fetches the page using one of three Scrapling fetchers (`http`, `stealth`, `browser`).
3. Parses the HTML.
4. Extracts title, language, headings, paragraphs, main text, links, images, and metadata (description, canonical URL, robots, Open Graph, Twitter Card).
5. Cleans text conservatively (whitespace/duplicate removal only — no rewriting, summarizing, or translation).
6. Returns a single, stable, JSON-serializable result — on success **or** failure.

Architecture (each layer only talks to its neighbors):

```
CLI (crawler_cli.py)
 │
 ▼
Crawler (crawler.py)
 │
 ├── PageFetcher   (fetcher.py)    — obtains the page via Scrapling; retries transient failures
 ├── HTMLParser    (parser.py)     — parses HTML into a Scrapling Selector document
 ├── ContentExtractor (extractor.py) — pulls structured content from the parsed document
 └── cleaners.py                  — conservative text normalization
 │
 ▼
CrawlResult (models.py)
```

---

## Installation

Requires Python 3.11+ and the installed Scrapling version is `0.4.14`.

```bash
python3 -m venv .venv
```

```bash
# Linux / macOS
source .venv/bin/activate
```

```bash
# Windows
.venv\Scripts\activate
```

Install the crawler and its dependencies (Scrapling's browser-based
fetchers — `stealth` and `browser` modes — require the `[fetchers]` extra,
which pulls in `curl_cffi`, Playwright, and Patchright):

```bash
pip install -e ".[dev]"
```

or, without the dev/test extras:

```bash
pip install -r requirements.txt
```

If you plan to use `--mode browser` or `--mode stealth`, Playwright/Patchright
also need their browser binaries installed once:

```bash
python -m playwright install chromium
```

(Scrapling's `StealthyFetcher` uses its own bundled Camoufox browser and
manages this separately — see Scrapling's own docs if `stealth` mode fails
to launch.)

---

## Basic Usage

```bash
python crawler_cli.py https://example.com
```

```bash
python crawler_cli.py https://example.com \
  --mode http \
  --timeout 30 \
  --max-redirects 5 \
  --max-response-size 10485760 \
  --links \
  --images \
  --metadata
```

```bash
python crawler_cli.py --help
```

**stdout carries only the JSON result.** All operational logs (fetch
status, retry attempts, extraction counts) go to **stderr**. This makes the
CLI safe to call from another program:

```bash
python crawler_cli.py https://example.com 2>/dev/null | jq .page.title
```

---

## Python Usage

```python
from standalone_crawler import Crawler, CrawlerConfig

crawler = Crawler()
result = crawler.crawl("https://example.com")

if result.success:
    print(result.page.title)
    print(len(result.links), "links found")
else:
    print(result.error.type, result.error.message)

print(result.to_json())
```

With custom configuration:

```python
config = CrawlerConfig(
    fetch_mode="stealth",   # "http" | "stealth" | "browser"
    timeout=45,
    max_retries=3,
    extract_images=False,
)
result = crawler.crawl("https://example.com", config)
```

See `examples/basic_crawl.py` for a runnable version of this, and
`examples/output_example.json` for a real (trimmed) result.

---

## Fetch Modes

Scrapling ships exactly three fetchers; the crawler exposes them 1:1 —
no other fetch mode names exist, and none are invented here:

| Mode      | Scrapling class    | What it does                                                        |
|-----------|---------------------|-----------------------------------------------------------------------|
| `http`    | `Fetcher`           | Plain HTTP/HTTPS request via `curl_cffi`. Fast, no JS execution.      |
| `stealth` | `StealthyFetcher`   | Camoufox-based anti-detection browser. Handles some anti-bot pages.   |
| `browser` | `DynamicFetcher`    | Playwright/Patchright browser. Executes JavaScript, renders the DOM.  |

Default is `http`. Use `stealth` or `browser` only when a page requires
JavaScript rendering or is blocking plain HTTP requests — both are
significantly slower and heavier (they launch a real browser process).

**Timeout units note:** `CrawlerConfig.timeout` is always expressed in
**seconds**, regardless of mode. Internally, `http` mode passes seconds
straight to `curl_cffi`, while `stealth`/`browser` modes convert to
milliseconds for Playwright, since that's the unit Scrapling's browser
fetchers expect.

---

## Output Schema

Every crawl returns a `CrawlResult` (see `models.py` for the exact Pydantic
schema). On success:

```json
{
  "success": true,
  "request": { "url": "...", "fetch_mode": "http" },
  "response": {
    "status_code": 200,
    "final_url": "...",
    "content_type": "text/html; charset=UTF-8",
    "response_time_ms": 241.01
  },
  "page": {
    "title": "...",
    "description": "...",
    "language": "en",
    "canonical_url": "..."
  },
  "content": {
    "text": "... full visible text (not semantic article extraction) ...",
    "headings": [{ "level": 1, "text": "..." }],
    "paragraphs": ["...", "..."]
  },
  "links": [
    { "text": "...", "url": "...", "rel": [], "external": false }
  ],
  "images": [
    { "src": "...", "alt": "...", "title": null }
  ],
  "metadata": {
    "description": "...",
    "keywords": null,
    "canonical": "...",
    "robots": null,
    "author": null,
    "og": { "title": "...", "description": "...", "image": "...", "type": "...", "site_name": "...", "url": "..." },
    "twitter": { "card": "...", "title": null, "description": null, "image": null, "site": null }
  },
  "error": null
}
```

See `examples/output_example.json` for a full real example (from
`https://pypi.org/project/scrapling/`, trimmed for length).

---

## Error Handling

A crawl **never raises** for expected failure modes. Instead it returns the
same `CrawlResult` shape with `success: false` and a populated `error`:

```json
{
  "success": false,
  "request": { "url": "not-a-url" },
  "response": null,
  "page": null,
  "content": null,
  "links": [],
  "images": [],
  "metadata": {},
  "error": { "type": "InvalidURL", "message": "..." }
}
```

Possible `error.type` values include `InvalidURL`, `SSRFBlocked`,
`RedirectLimitExceeded`, `ResponseTooLarge`, `FetchTimeout`, `HTTPError`,
`FetchError`, `ParsingError`, and `ExtractionError`. Unexpected exceptions
are also caught and returned as structured JSON rather than an unhandled
traceback.

The CLI's process exit code is `0` on success, `1` on failure.

---

## Configuration

| Field                | Default | Notes |
|-----------------------|---------|-------|
| `fetch_mode`          | `"http"` | `"http"` \| `"stealth"` \| `"browser"` |
| `timeout`              | `30.0`  | Seconds, applies to all modes |
| `max_retries`          | `2`     | Retries for transient failures only (see below) |
| `max_redirects`        | `5`     | Maximum redirect hops in HTTP mode; browser navigation is bounded by the same setting |
| `max_response_size`    | `10485760` | Maximum received response body size in **bytes**; `None` disables the post-fetch size check |
| `retry_backoff_base`   | `0.5`   | Seconds; exponential backoff: `base * 2^(attempt-1)` |
| `user_agent`           | `None`  | Overrides the fetcher's default UA when set |
| `verify_tls`           | `True`  | Never silently disabled |
| `headless`             | `True`  | `stealth`/`browser` modes only |
| `network_idle`         | `False` | `stealth`/`browser` modes only |
| `extract_links`        | `True`  | |
| `extract_images`       | `True`  | |
| `extract_metadata`     | `True`  | |
| `clean_text`           | `True`  | |
| `allowed_schemes`      | `("http", "https")` | URLs outside this are rejected before any fetch |
| `block_private_networks` | `True` | SSRF protection (see below); set `False` only for trusted internal-use deployments |

**Retry policy:** `401`, `403`, and `404` are never retried (spec
requirement). `408`, `425`, `429`, `500`, `502`, `503`, `504`, timeouts, and
connection-level failures are retried up to `max_retries` times with
exponential backoff.

No credentials, cookies, or API keys are modeled in `CrawlerConfig` — none
are needed, and none should be hard-coded per the project's security
requirements.

---

## Security

The standalone crawler is designed to be a safe backend for explicitly
supplied URLs, not an unrestricted network client.

- Allowed URL schemes default to `http` and `https`.
- Private, loopback, link-local, reserved, multicast, and unspecified
  addresses are blocked by default.
- HTTP redirect destinations are checked before each redirect is followed.
- Redirect chains are finite.
- Response bodies are subject to a configurable size limit.
- URLs are passed to Scrapling as function arguments; they are never
  interpolated into shell commands. No `shell=True`, `os.system`, or
  string-built subprocess execution is used.
- The project does not model or log cookies, credentials, or API keys.
- stdout is reserved for the machine-readable JSON contract; operational
  logs go to stderr.

## Limitations

- **JavaScript-dependent pages**: `http` mode does not execute JavaScript.
  Pages that render content client-side need `--mode browser` or
  `--mode stealth`.
- **Authentication**: not supported. No cookie/session/login handling is
  implemented, and none should be added to this standalone component.
- **CAPTCHA**: not bypassed. Pages behind a CAPTCHA wall will return
  whatever the server serves (often a challenge page), not the underlying
  content.
- **`robots.txt`**: **not fetched or honored automatically.** This Phase 1
  crawler only fetches URLs it is explicitly given — it does not discover
  or follow links, so a robots.txt-driven crawl policy is out of scope. If
  you build automated multi-page crawling on top of this component later,
  add robots.txt checking at that layer.
- **Rate limits**: no built-in throttling between distinct calls to
  `crawl()`. If you call this in a loop across many URLs, add your own
  delay between requests.
- **SSRF protection**: enabled by default. The initial URL is resolved and
  checked before fetching. In HTTP mode, redirects are followed manually so
  every `Location` target is validated for scheme and private/reserved IP
  addresses **before** the next request. Browser/stealth mode installs a
  Scrapling `page_setup` route guard that blocks private/reserved HTTP(S)
  requests, including navigation redirects. This is still a best-effort
  resolve-then-check design and is not a complete defense against DNS
  rebinding at the TCP connection layer. Set
  `block_private_networks=False` only for trusted internal-use deployments.
- **Redirects**: HTTP mode exposes a finite `max_redirects` limit (default 5).
  Browser/stealth navigation is also bounded by the same setting. The browser
  fetchers do not expose the same low-level per-redirect response hook as the
  HTTP fetcher, so the browser guard is implemented at the request-routing
  layer.
- **Response size**: the default limit is 10 MiB (10 * 1024 * 1024 bytes).
  When `Content-Length` is available, an oversized response is rejected
  before body processing. After Scrapling returns a response, the actual
  received body size is checked as well, including responses without
  `Content-Length` and chunked responses where the underlying fetcher exposes
  the complete body. This layer cannot guarantee that Scrapling/browser never
  temporarily buffers more than the configured limit internally; the hard
  guarantee is on processing/acceptance, not underlying transport buffering.
- **Text extraction semantics**: `content.text` is **visible-text extraction**,
  not semantic main-article extraction. It removes script/style/noscript/
  template/svg content but may include navigation, header, footer, and sidebar
  text. `extract_main_text()` remains as a backward-compatible alias for
  `extract_visible_text()` and is intentionally not described as article
  extraction.
- **Protected/anti-bot websites**: `stealth` mode improves success against
  some anti-bot systems but is not guaranteed to bypass all of them, and
  this project does not attempt to circumvent access controls, rate-limit
  evasion, or CAPTCHA solving by design.
- **Single-page only**: this phase does not crawl discovered links. Given
  a URL, it fetches exactly that URL.

---

## Future Integration

This crawler is designed to be consumed later by an external agent or
plugin (e.g. an OpenCode tool) via its stable programmatic API
(`Crawler.crawl()` → `CrawlResult`) or via its stdout-JSON CLI contract.
That integration is out of scope for this phase and is not implemented here.

---

## Development

Run the test suite:

```bash
pip install -e ".[dev]"
pytest
```

The suite covers URL validation, direct and redirect SSRF protection,
redirect limits, response-size limits, retry/backoff logic, HTML parsing,
content extraction (including the visible-text semantics and `clean_text`
toggle), text cleaning, `CrawlerConfig` validation, CLI argument handling,
the crawler orchestration layer, and the CLI. The integration smoke test
makes one real request to a stable public page and is skipped automatically
if network access is unavailable.

```
crawler/
├── src/standalone_crawler/
│   ├── __init__.py
│   ├── config.py          # CrawlerConfig (pydantic)
│   ├── models.py           # PageResponse, CrawlResult, and sub-models
│   ├── fetcher.py          # PageFetcher — Scrapling dispatch + retries
│   ├── parser.py           # HTMLParser — wraps Scrapling's Selector
│   ├── extractor.py        # ContentExtractor — structured extraction
│   ├── crawler.py           # Crawler — orchestrates the full pipeline
│   ├── cleaners.py          # conservative text cleaning
│   ├── exceptions.py        # InvalidURL, FetchError, FetchTimeout, ...
│   └── logging_config.py    # stderr-only structured logging
├── tests/
│   ├── fixtures/             # static + malformed HTML fixtures
│   ├── test_fetcher.py
│   ├── test_parser.py
│   ├── test_extractor.py
│   ├── test_cleaners.py
│   ├── test_crawler.py
│   ├── test_cli.py
│   └── test_integration_smoke.py
├── examples/
│   ├── basic_crawl.py
│   └── output_example.json
├── crawler_cli.py
├── pyproject.toml
├── requirements.txt
└── README.md
```

---

## Scrapling Capabilities Not Used in Phase 1

Documented per the spec's final requirement (list what was intentionally
left out and why):

- **Scrapling's built-in Spider/crawling framework** (multi-page crawling)
  — this phase is explicitly single-URL only.
- **Scrapling's `google_search` browser option** — this project does not
  use any search API/service by requirement; that browser-session flag is
  never set.
- **Scrapling's proxy rotation (`ProxyRotator`)** — not exposed in
  `CrawlerConfig`; can be added later if a use case requires it.
- **Scrapling's `capture_xhr`** (capturing background XHR/fetch requests
  in browser mode) — out of scope; this crawler extracts rendered HTML
  content only, not intercepted network traffic.
- **Cloudflare challenge solving (`solve_cloudflare`)** — deliberately not
  enabled, consistent with the "do not implement CAPTCHA/access-control
  bypassing" requirement.
