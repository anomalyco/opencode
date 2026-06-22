---
name: ultimate-browsing
description: "Escalation skill for blocked or hard-to-reach web access — load it when a normal browse/fetch is blocked (WAF, 403, Cloudflare, JS-only render, login-gated, or a platform a generic fetcher cannot read). Tiered router: TIER 1 insane-search (headless extraction + WAF bypass via curl_cffi TLS impersonation, yt-dlp, Jina Reader, public APIs, Playwright real-Chrome fallback); TIER 1.5 agent-reach (platform-native readers for Chinese and social platforms: Xiaohongshu, Douyin, Weibo, Bilibili, V2EX, WeChat, plus Twitter/Reddit/LinkedIn/GitHub); TIER 2 Chrome stealth (CloakBrowser stealth Chromium + agent-browser CDP for clicks, forms, screenshots, video, cookie login). Triggers: blocked site, bypass bot detection, cloudflare/WAF bypass, scrape, stealth browser, import cookies, fill form, screenshot, play youtube, xiaohongshu, douyin, weibo, bilibili, v2ex, wechat article, podcast transcript. NOT for simple searches (use web-search) or plain fetches (use webfetch)."
---

# Ultimate Browsing

Escalation web access for tasks a normal browse or fetch cannot complete. Reach for this skill the moment a page is blocked (WAF / 403 / Cloudflare), needs JS rendering, hides behind a login, or lives on a platform a generic fetcher cannot read. Escalate only when the cheaper tier cannot do the job:

**Tier 1 — insane-search** (headless extraction + WAF bypass) -> **Tier 1.5 — agent-reach** (platform-native APIs, esp. Chinese platforms) -> **Tier 2 — Chrome stealth** (real interaction via CloakBrowser + agent-browser).

## PHASE 0 — ROUTE FIRST (MANDATORY)

```
User request
  |
  +- extract text/data from a URL --------------------- TIER 1  insane-search
  +- URL blocked / 403 / Cloudflare / WAF ------------- TIER 1  insane-search
  +- YouTube/Vimeo/TikTok subtitles or metadata ------- TIER 1  insane-search (yt-dlp)
  +- read an article / blog / Reddit / HN / arXiv ----- TIER 1  insane-search
  |
  +- Chinese platform (xhs/douyin/weibo/bilibili/v2ex/wechat)  TIER 1.5 agent-reach
  +- podcast transcript / stock forum ----------------- TIER 1.5 agent-reach
  +- Twitter feed / LinkedIn profile / GitHub via CLI - TIER 1.5 agent-reach
  |
  +- Tier 1/1.5 returned empty or partial ------------- TIER 2  Chrome stealth
  +- click / fill form / scroll / interact ------------ TIER 2  Chrome stealth
  +- screenshot / render / play video ----------------- TIER 2  Chrome stealth
  +- login session across pages / inject cookies ------ TIER 2  Chrome stealth
  +- test web app / QA / dogfood ---------------------- TIER 2  Chrome stealth
  |
  +- simple search query ------------------------------ NOT this skill (use web-search)
```

Read the matching reference before acting: [`references/insane-search/README.md`](references/insane-search/README.md), [`references/agent-reach/README.md`](references/agent-reach/README.md), or [`references/chrome-stealth.md`](references/chrome-stealth.md).

## Tier 1 — insane-search (headless extraction)

**When**: content extraction, blocked-URL bypass, media metadata — no browser UI needed.
**Why first**: ~10x faster than a browser, no process spin-up; handles most "fetch this blocked page" requests via curl_cffi TLS impersonation, yt-dlp (1858 sites), Jina Reader, official public APIs, mobile URL transforms, and a Playwright real-Chrome fallback. The engine lives **inside this skill** at `engine/` and is invoked as a module.

```bash
# Core command — auto-detects WAF, runs the full fetch grid (run from the skill dir):
python3 -m engine "https://example.com/blocked-page"
#   add --selector "<CSS>" for positive-proof validation, --device auto|desktop|mobile,
#   --trace to inspect every attempt, --json for machine-readable output.

# YouTube subtitles / metadata (no browser):
yt-dlp --write-sub --write-auto-sub --sub-lang "en,ko" --skip-download -o "/tmp/%(id)s" "<URL>"

# Reddit / HN / Bluesky / arXiv etc. use official public endpoints — see the Phase 0 index in
# references/insane-search/README.md (Twitter syndication, Reddit .json, HN Firebase, ...).
```

The full engine harness (rules R1-R7, the Phase 0 official-API index, the no-site-name rule, and the `references/insane-search/*.md` deep-dives for TLS, Playwright routing, Naver, media, etc.) is in [`references/insane-search/README.md`](references/insane-search/README.md). Read it before tuning the engine or adding a WAF profile.

### Escalate to Tier 1.5 or Tier 2 when
- The target is a Chinese / social platform with a native reader -> Tier 1.5.
- insane-search returns empty/partial, or the page needs JS interaction, a screenshot, a persistent login, or media playback -> Tier 2.

## Tier 1.5 — agent-reach (platform-native readers)

**When**: the target is a platform with a first-class API/CLI that beats generic fetching — especially Chinese platforms that stealth browsers still cannot reach cleanly. Several channels are zero-config (Douyin, Weibo via Jina, V2EX, Reddit, Jina Reader, RSS, YouTube); others need a one-time auth you supply via environment variables if you have access.

| Category | Platforms | Entry |
|---|---|---|
| social | xhs (Xiaohongshu), douyin, weibo, bilibili, V2EX, Reddit, Twitter/X | [references/agent-reach/social.md](references/agent-reach/social.md) |
| web | Jina Reader, WeChat articles, RSS | [references/agent-reach/web.md](references/agent-reach/web.md) |
| video | YouTube, Bilibili, podcast transcripts, Douyin video | [references/agent-reach/video.md](references/agent-reach/video.md) |
| career | LinkedIn | [references/agent-reach/career.md](references/agent-reach/career.md) |
| dev | GitHub (gh CLI) | [references/agent-reach/dev.md](references/agent-reach/dev.md) |
| search | Exa AI | [references/agent-reach/search.md](references/agent-reach/search.md) |

```bash
mcporter call 'douyin.parse_douyin_video_info(url: "<URL>")'   # douyin, zero-config
curl -s "https://r.jina.ai/https://weibo.com/<uid>/<pid>"      # weibo via Jina
yt-dlp --dump-json "<bilibili-url>"                            # Bilibili (overseas: add --cookies-from-browser)
curl -s "https://www.v2ex.com/api/topics/hot.json"            # V2EX public API
```

Routing table, per-platform auth (set `TWITTER_*` env vars, `gh auth login`, a transcription key — only if you have access), rate-limit notes, and known version quirks are in [references/agent-reach/README.md](references/agent-reach/README.md).

## Tier 2 — Chrome stealth (real interaction)

**When**: real interaction is needed (clicks, forms, screenshots, video, persistent login), or Tier 1/1.5 failed.

CloakBrowser is a stealth Chromium with source-level fingerprint patches that passes Cloudflare Turnstile, FingerprintJS, BrowserScan, and 30+ detectors; agent-browser is the CDP automation CLI that drives it. Both are runtime-installed tools (not vendored here). Full setup, version pins, launch flow, cookie login, and cross-platform notes are in [references/chrome-stealth.md](references/chrome-stealth.md).

```bash
# 1. Launch CloakBrowser with CDP on :9242 (see chrome-stealth.md for install + venv).
# 2. CloakBrowser launches tabless — open the first tab via CDP before any agent-browser command:
curl -s -X PUT "http://127.0.0.1:9242/json/new?https://example.com"
# 3. Drive it with agent-browser over CDP:
agent-browser --cdp 9242 snapshot -i        # interactive elements (@eN refs)
agent-browser --cdp 9242 click @e3
agent-browser --cdp 9242 screenshot out.png
agent-browser --cdp 9242 close
```

### Cookie login (cross-platform)

`scripts/extract_cookies.py` reads cookies from a local Chromium-family or Firefox-family browser and optionally injects them into the running CDP session. It resolves browser profile paths and decrypts cookie values per-OS (macOS Keychain, Linux libsecret, Windows DPAPI):

```bash
# Extract cookies to a file:
python3 scripts/extract_cookies.py --browser chrome --domain youtube.com --output /tmp/cookies.json
# Extract and inject into the running CDP session:
python3 scripts/extract_cookies.py --browser chrome --domain youtube.com --inject --cdp 9242
```

Cookies apply on next navigation — reload after injecting. Google services use fingerprint-bound tokens that may not transfer across browser profiles. Full detail in [references/chrome-stealth.md](references/chrome-stealth.md).

## Reference docs

| File | When to read |
|------|-------------|
| [references/insane-search/README.md](references/insane-search/README.md) | Tier-1 engine harness (R1-R7, Phase 0 API index, no-site-name rule) + its `*.md` deep-dives |
| [references/agent-reach/README.md](references/agent-reach/README.md) | Tier-1.5 routing table, platform auth, per-category `*.md` |
| [references/chrome-stealth.md](references/chrome-stealth.md) | Tier-2 CloakBrowser + agent-browser install, CDP flow, version pins, cookie login |

## Environment variables

```bash
CLOAK_CDP_PORT=9242              # CloakBrowser CDP port (default 9242)
AGENT_BROWSER_USER_AGENT="..."   # override UA to hide HeadlessChrome
AGENT_BROWSER_HEADED=1           # show the browser window
# agent-reach auth: set the channel-specific env vars from each tool's docs only if you have access
# insane-search needs no env vars — it auto-installs deps on first run
```

## Anti-patterns

- Do NOT launch Chrome stealth for plain text extraction — use Tier 1.
- Do NOT pass an `--init-script` for the webdriver flag — CloakBrowser already patches it at source; the only required override is `--user-agent`.
- Do NOT run agent-browser before creating the first tab via `curl -X PUT .../json/new` — CloakBrowser launches tabless.
- Do NOT use vanilla Chrome when stealth is needed — always CloakBrowser.
- Do NOT forget to `close` the session when done.
- Do NOT inject cookies without reloading the page.
- Do NOT hardcode site domains/selectors into `engine/**` or `waf_profiles.yaml` — runtime hints only (see the no-site-name rule in the insane-search reference).
