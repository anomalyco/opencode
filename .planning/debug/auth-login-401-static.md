---
status: resolved
trigger: "Investigate blank /auth/login with 401 errors when running bun run dev:web. Find auth middleware/basic auth/csrf for static assets. Determine why login.html/js/css from uiDir returns 401. Identify fix. Report paths and changes needed. Search server routes and middleware ordering. Check basic auth in server.ts, static serving. Return recommendation."
created: 2026-01-31T22:21:43Z
updated: 2026-01-31T22:32:00Z
---

## Current Focus

<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: auth middleware is blocking uiDir static assets for unauthenticated users
test: trace middleware ordering and auth allowlist vs static paths
expecting: confirm 401 originates from auth middleware before static serving
next_action: implement auth allowlist for uiDir assets

## Symptoms

<!-- Written during gathering, then IMMUTABLE -->

expected: /auth/login renders HTML + loads js/css from uiDir without auth
actual: /auth/login blank; login.html/js/css from uiDir return 401
errors: 401 responses for static assets (login.html/js/css)
reproduction: run `bun run dev:web`, open /auth/login
started: unknown

## Eliminated

<!-- APPEND only - prevents re-investigating -->

## Evidence

<!-- APPEND only - facts discovered -->

- timestamp: 2026-01-31T22:22:52Z
  checked: packages/opencode/src/server/server.ts
  found: authMiddleware and csrfMiddleware are applied globally before uiDir static serving; uiDir static handling is in two .use("/\*") blocks after auth middleware.
  implication: unauthenticated requests for uiDir assets hit authMiddleware first and can be blocked with 401.
- timestamp: 2026-01-31T22:22:52Z
  checked: packages/opencode/src/server/middleware/auth.ts
  found: authMiddleware only bypasses /auth/_ and /health; all other paths require session and return 401 for non-HTML accept headers.
  implication: asset requests like /assets/_, /src/login/index.tsx, /oc-theme-preload.js are treated as API calls and receive 401 when not authenticated.
- timestamp: 2026-01-31T22:22:52Z
  checked: packages/app/login.html
  found: login page references root-relative static assets (e.g., /oc-theme-preload.js, /src/login/index.tsx, /favicon.ico).
  implication: login page depends on static assets that are currently blocked by auth middleware when unauthenticated.

## Resolution

<!-- OVERWRITE as understanding evolves -->

root_cause: authMiddleware runs before uiDir static serving and only allowlists /auth/_; unauthenticated asset requests (e.g., /assets/_, /oc-theme-preload.js, /src/login/index.tsx) are treated as API calls and return 401, so /auth/login renders a blank page.
fix: allow unauthenticated access to uiDir static assets by detecting file requests under uiDir in auth middleware.
verification: confirmed `/auth/login` loads without 401s after restart (bun run dev:web)
files_changed:

- packages/opencode/src/server/middleware/auth.ts
