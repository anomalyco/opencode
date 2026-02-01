---
status: verifying
trigger: "Investigate issue: docker-csp-connect-src"
created: 2026-01-29T00:00:00Z
updated: 2026-01-29T00:00:04Z
---

## Current Focus

hypothesis: CSP connect-src is too restrictive for UI that targets localhost from a non-localhost origin
test: verify CSP in Docker by reproducing login flow
expecting: browser allows fetches to http://localhost:3000 and UI loads post-login
next_action: ask user to retry Docker flow and report CSP console output

## Symptoms

expected: App loads main UI/dashboard normally after login.
actual: UI shows "something went wrong" and requests to http://localhost:3000/\* are blocked by CSP; main page doesn't load.
errors: Browser console logs show CSP violations: connect-src 'self' blocks fetch to http://localhost:3000/auth/session, /global/health, /global/event. site.webmanifest 401. No container logs checked yet.
reproduction: Happens every login (first run).
started: First time running in Docker.

## Eliminated

## Evidence

- timestamp: 2026-01-29T00:00:00Z
  checked: packages/opencode/src/server/server.ts
  found: contentSecurityPolicy is hardcoded with "connect-src 'self'" and applied to responses
  implication: browser will block any fetches to origins not equal to the page origin
- timestamp: 2026-01-29T00:00:00Z
  checked: packages/opencode/src/server/server.ts proxy fallback
  found: UI requests are proxied to config.server.uiUrl (default https://app.opencode.ai) and CSP header is overwritten via withCsp()
  implication: UI served via proxy still receives hardcoded CSP with connect-src 'self'
- timestamp: 2026-01-29T00:00:01Z
  checked: packages/app/src/context/server.tsx, packages/app/src/context/global-sdk.tsx
  found: app uses server.url as baseUrl for API calls and events; server.url is derived from defaultUrl or user selection
  implication: if defaultUrl points to localhost while page origin is different, API calls will target localhost
- timestamp: 2026-01-29T00:00:02Z
  checked: packages/app/src/app.tsx
  found: default server URL uses VITE_OPENCODE_SERVER_URL if set, otherwise window.location.origin
  implication: a build-time env could force localhost regardless of page origin
- timestamp: 2026-01-29T00:00:04Z
  checked: lints for packages/opencode/src/server/server.ts
  found: no linter issues
  implication: CSP change does not introduce lint errors

## Resolution

root_cause:
CSP header sets connect-src to 'self' only, so when the UI targets http://localhost:3000 from a non-localhost origin (e.g. host IP), those API calls are blocked by CSP.
fix:
Expanded CSP connect-src to allow localhost, 127.0.0.1, and host.docker.internal on any port.
verification:
files_changed: ["packages/opencode/src/server/server.ts"]
