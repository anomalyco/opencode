---
status: verifying
trigger: "Investigate issue: route-refresh-404"
created: 2026-01-29T18:48:11Z
updated: 2026-01-29T18:56:09Z
---

## Current Focus

hypothesis: SPA fallback handler is still bypassed, so browser refreshes hit 404
test: refresh deep route after adding html fallback in catch-all
expecting: text/html requests return index.html instead of 404
next_action: ask user to refresh deep route in browser to confirm

## Symptoms

expected: Refreshing deep UI routes should serve index.html (SPA fallback) and app should load.
actual: Refreshing deep UI routes returns 404 with ERR_INVALID_RESPONSE. Example: GET http://127.0.0.1:4096/L1VzZXJzL3BldGVycnlzemtpZXdpY3ovM0QgTW9kZWxz/session 404.
errors: Browser console errors only.
reproduction: Run `bun run dev web`, navigate to route with encoded path, refresh.
started: Started after static serving changes.

## Eliminated

## Evidence

- timestamp: 2026-01-29T18:48:51Z
  checked: packages/opencode/src/server/server.ts route order
  found: static middleware `.use("/*", serveStatic(...))` runs before `.get("/*")` index fallback and `.all("/*")` 404 handler
  implication: if serveStatic returns 404 on missing files, deep routes never reach index.html fallback
- timestamp: 2026-01-29T18:52:18Z
  checked: curl GET to deep route with Accept: text/html
  found: server responds 302 redirect to /auth/login (auth enabled in local config)
  implication: manual browser verification needed to confirm SPA fallback behavior
- timestamp: 2026-01-29T18:55:37Z
  checked: user verification after login
  found: refresh still returns 404/ERR_INVALID_RESPONSE at http://127.0.0.1:4096/
  implication: SPA fallback still bypassed or not matching; need stronger fallback

## Resolution

root_cause: SPA fallback not guaranteed when routes miss; catch-all returned 404 for html navigations
fix: serve index.html for text/html GET/HEAD in catch-all and via explicit helper
verification:
files_changed:

- packages/opencode/src/server/server.ts
