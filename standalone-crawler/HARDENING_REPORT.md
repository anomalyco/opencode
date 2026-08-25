# Phase 1.6 Final Security Hardening & OpenCode-Readiness Report

## 1. Changes Made

- Pinned `scrapling[fetchers]` to exactly `0.4.14` in `pyproject.toml` and `requirements.txt`.
- Added `CrawlerConfig.max_redirects` with a finite default of `5`.
- Added `CrawlerConfig.max_response_size` with a default of `10 * 1024 * 1024` bytes; `None` disables the post-fetch size check.
- Added `RedirectLimitExceeded` and `ResponseTooLarge` structured error types.
- Changed HTTP fetching to disable automatic redirects and manually validate every redirect target before following it.
- Added redirect target scheme validation and SSRF validation for every HTTP redirect hop.
- Added browser/stealth `page_setup` request routing that blocks private/reserved HTTP(S) requests and bounds top-level navigation hops.
- Added declared `Content-Length` checks and actual received-body-size checks.
- Applied response-size checks to intermediate HTTP redirect responses as well as the final response.
- Renamed the semantic implementation to `extract_visible_text()`. Kept `extract_main_text()` as a backward-compatible alias so existing callers do not break.
- Updated `Crawler.crawl()` to use the accurately named visible-text extraction method.
- Updated CLI with `--max-redirects` and `--max-response-size`.
- Added regression tests for redirect SSRF, redirect limits, response size, browser routing, configuration validation, CLI safety options, and visible-text semantics.
- Updated README to document dependency pinning, security behavior, redirect limits, response-size behavior, fetch-mode limitations, and visible-text semantics.
- No OpenCode, MCP, LLM, search API, or agent logic was added.

## 2. Security Improvements

### Redirect SSRF

HTTP mode now uses `follow_redirects=False` at the Scrapling layer and follows redirects itself. Every `Location` target is validated for an allowed scheme and checked with the existing DNS/IP SSRF guard before the next request is made.

Browser/stealth mode installs a `page_setup` route guard. It checks HTTP(S) requests, including top-level navigation requests, and aborts requests targeting private/reserved addresses. This also prevents a page from pivoting into an internal network through a subresource.

### Response size

A configurable 10 MiB default limit is now enforced.

- `Content-Length` above the limit is rejected before the crawler processes the response body.
- Actual received body size is checked after Scrapling returns the response.
- Responses without `Content-Length` and chunked responses are therefore covered when the underlying fetcher exposes the received body.
- The implementation does **not** claim that Scrapling/browser transport buffering itself is hard-capped before receipt; the guaranteed boundary is acceptance/processing by this crawler layer.

### Redirect limit

HTTP redirects are limited to 5 hops by default.

Browser/stealth top-level navigation requests are bounded using the same configuration. A redirect loop therefore cannot continue indefinitely.

### URL validation

The existing `http`/`https` scheme restriction and direct SSRF protection remain enabled by default. Private, loopback, link-local, reserved, multicast, and unspecified addresses are blocked.

## 3. Scrapling Version

Validated version: `0.4.14` (from the previous Phase 1.5 audit and project dependency target)

Pinned version: `0.4.14`

Installed version: **I cannot confirm this in the current environment.**

Reason: the execution environment did not have Scrapling installed, and an attempt to install the exact pinned package failed because external package-index DNS/network access was unavailable. Therefore I did not fabricate a real installed-version result.

The previous audit had already verified the project against an actually installed `scrapling==0.4.14`. fileciteturn0file0L17-L21

## 4. Fetch Mode Validation

| Mode | API Verified | Real Smoke Test | Status |
|---|---|---|---|
| HTTP | Yes — previously verified against Scrapling 0.4.14; current code uses documented `follow_redirects=False` behavior | No — current environment could not install/run Scrapling | READY FOR ENVIRONMENT VERIFICATION |
| Stealth | Yes — fetcher signature was previously verified; `page_setup` is supported by Scrapling browser fetchers | No | READY WITH LIMITATIONS |
| Browser | Yes — fetcher signature was previously verified; `page_setup` is supported by Scrapling browser fetchers | No | READY WITH LIMITATIONS |

Scrapling's documentation describes `follow_redirects=False` for disabling automatic redirects in the HTTP fetcher, and Scrapling's release history documents `page_setup` for browser fetchers from v0.4.6 onward. citeturn1search2turn1search0

The prior audit explicitly reported that HTTP, stealth, and browser API calling conventions were checked against the installed Scrapling 0.4.14 package, while real browser processes were not available in that environment. fileciteturn0file0L84-L87

## 5. Test Results

Tests: `117` collected test functions in the hardened source tree

Passed: `117` under a local compatibility stub for the unavailable Scrapling runtime

Failed: `0`

Skipped: `1` (real-network integration smoke test under the stub environment)

Coverage: **I cannot confirm the post-hardening real-Scrapling coverage percentage in the current environment.** The previous real audit measured 90% coverage before this phase. fileciteturn0file0L68-L87

Important limitation: the 117-test run was not a real Scrapling run; it used a small local compatibility stub solely to exercise the project-layer regression suite because Scrapling could not be installed in the sandbox. The earlier Phase 1.5 result remains the last real-Scrapling baseline: 102 passing tests and 90% coverage. fileciteturn0file0L48-L65

Additional checks completed in this environment:

- Python compilation of source, CLI, and tests: passed.
- Configuration tests with the real installed Pydantic: 11 passed.
- Configuration + cleaner tests: 26 passed.
- Fetcher/security tests using a Scrapling API stub: 41 passed.
- CLI tests using a Scrapling API stub: 7 passed.
- Parser/extractor/crawler tests using a selector compatibility stub: 43 passed.
- Combined compatibility-stub suite: 117 passed, 1 skipped.

## 6. Security Test Results

Verified by tests in the hardened tree:

- Direct loopback/private/link-local/metadata IPv4 blocking.
- IPv6 loopback blocking.
- DNS-resolved private address blocking.
- SSRF protection disabled means no DNS lookup is performed.
- Public IP literal allowed.
- Public URL → private redirect is blocked before the next HTTP request.
- Relative HTTP redirect is validated and followed.
- Redirect loop is bounded by `max_redirects`.
- Declared `Content-Length` above the configured maximum is rejected.
- Actual received response size above the configured maximum is rejected.
- Response-size limit can be disabled explicitly with `None`.
- Browser/stealth route guard blocks private navigation.
- Browser/stealth route guard allows public navigation.
- Browser/stealth navigation limit is enforced.
- Invalid URL schemes remain blocked.
- CLI safety options are propagated into `CrawlerConfig`.
- stdout JSON behavior remains covered.
- No credentials/cookies/API-key fields were introduced into configuration or logging.

## 7. Known Limitations

- **Real Scrapling execution could not be performed in this environment.** I cannot confirm this in the current environment.
- **Real stealth smoke test:** I cannot confirm this in the current environment.
- **Real browser smoke test:** I cannot confirm this in the current environment.
- **Post-hardening real coverage percentage:** I cannot confirm this in the current environment.
- Browser/stealth response-size enforcement is necessarily a post-fetch acceptance check because the project does not control the browser engine's complete transport buffering lifecycle.
- Browser/stealth SSRF protection uses a request-routing guard. It blocks private/reserved HTTP(S) requests, but it is still subject to the fundamental DNS resolve/connect TOCTOU limitation described by the earlier audit.
- DNS rebinding is not fully closed at this standalone layer.
- `robots.txt` remains intentionally out of scope.
- Authentication/cookie/session handling remains out of scope.
- CAPTCHA/access-control bypass logic remains out of scope.
- Windows behavior is source-level reviewed but not runtime-tested in this environment.
- No OpenCode/MCP/LLM/agent integration has been added, by design.

The previous audit also correctly identified response-size enforcement and redirect-count exposure as the two remaining hardening areas before fully untrusted network exposure. fileciteturn0file0L264-L283

## 8. OpenCode Readiness

**READY WITH LIMITATIONS**

The standalone architecture remains intact:

```text
Standalone Crawler
       |
   +---+---+ 
   |   |   |
 Fetcher Parser Extractor
       \   /
        \ /
     CrawlResult
         |
     JSON / Python API
```

There is no OpenCode, MCP, LLM, search API, or agent decision logic inside the project.

The security and configuration gaps identified by Phase 1.5 have been addressed at the project layer: redirect validation, finite redirect handling, response-size enforcement, exact Scrapling pinning, and accurate visible-text semantics.

However, this should **not** be called fully production-verified until the pinned `scrapling==0.4.14` package is installed in a clean environment and the real HTTP, stealth, and browser smoke tests plus the complete real test suite are executed.

**STOP CONDITION:** Phase 1.6 is complete at the code/hardening level. Do not start OpenCode integration until the clean-environment verification above is performed.
