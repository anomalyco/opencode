import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "bun:test"

import { navigateFallbackAllowlist } from "./pwa"

/**
 * @spec-handoff
 * @interface navigateFallbackAllowlist: RegExp[]
 *   Exported from `packages/app/src/pwa.ts`. An array of RegExp matching the
 *   SPA navigation routes that the service worker should serve the app shell
 *   for (navigation fallback). Used to configure the PWA's
 *   `navigateFallbackAllowlist`.
 *
 * @behavior
 *   - The array MUST contain exactly these four patterns (upstream routes,
 *     verified against packages/app/src/app.tsx on upstream/dev):
 *       1. root            -> source: ^\/$
 *       2. new-session      -> source: ^\/new-session$
 *       3. session route    -> source: ^\/[^/]+\/session(\/[^/]+)?$
 *       4. bare directory   -> source: ^\/(?!doc$)[A-Za-z0-9_-]+$
 *   - Pattern 3 matches `/:dir/session` and `/:dir/session/:id?` (optional id).
 *   - Pattern 4 matches a single URL-safe base64 segment `:dir` and EXCLUDES
 *     the reserved server path `/doc` (the OpenAPI doc) via negative lookahead.
 *
 * @rationale (upstream routes — NOT the fork)
 *   This contribution targets anomalyco/opencode upstream. Upstream SPA routes:
 *       /                      (HomeRoute)
 *       /new-session           (DraftRoute)
 *       /:dir                  (DirectoryLayout) — single URL-safe base64 segment
 *       /:dir/session/:id?     (SessionRoute, optional id)
 *   The server reserves `/doc` (OpenAPI) as a single-segment top-level path that
 *   must be excluded from the bare-`:dir` catch-all.
 *
 * @edge-cases / @no-login-literal-rule
 *   - DO NOT add a dedicated `/^\/login$/` pattern. That `/login` page exists
 *     only in the downstream fork, not upstream. The test asserts NO array
 *     element has source exactly `^\/login$`.
 *   - The generic bare-`:dir` catch-all (pattern 4) WILL incidentally match
 *     `/login` as if it were a directory name. That is correct upstream
 *     behavior: any bare segment is treated as a `:dir`. Do not special-case it.
 *   - `/foo/bar/baz` (too deep) must NOT match any pattern.
 *   - `/doc` must NOT match (excluded by pattern 4's negative lookahead).
 *
 * @see ./app.tsx (route definitions)
 */

describe("navigateFallbackAllowlist", () => {
  const matches = (path: string) => navigateFallbackAllowlist.some((re) => re.test(path))

  test("matches the root route", () => {
    expect(matches("/")).toBe(true)
  })

  test("matches the new-session route", () => {
    expect(matches("/new-session")).toBe(true)
  })

  test("matches a bare directory segment", () => {
    expect(matches("/myproject")).toBe(true)
  })

  test("matches a URL-safe base64 directory segment", () => {
    expect(matches("/L1VzZXJzL2Zvbw")).toBe(true)
  })

  test("matches a session route without id", () => {
    expect(matches("/myproject/session")).toBe(true)
  })

  test("matches a session route with id", () => {
    expect(matches("/myproject/session/abc123")).toBe(true)
  })

  test("does not match the reserved /doc path", () => {
    expect(matches("/doc")).toBe(false)
  })

  // Guards the anchored exclusion (?!doc$) from regressing to an unanchored
  // (?!doc): `/docs` is a valid bare :dir route and MUST still match. Only the
  // exact `/doc` server path is excluded.
  test("matches /docs (anchored exclusion does not over-exclude doc-prefixed dirs)", () => {
    expect(matches("/docs")).toBe(true)
  })

  test("does not match a path that is too deep", () => {
    expect(matches("/foo/bar/baz")).toBe(false)
  })

  test("does not include a dedicated /login literal pattern (fork-only)", () => {
    expect(navigateFallbackAllowlist.some((re) => re.source === "^\\/login$")).toBe(false)
  })

  test("locks the exact allowlist patterns (order and content)", () => {
    expect(navigateFallbackAllowlist.map((re) => re.source)).toEqual([
      "^\\/$",
      "^\\/new-session$",
      "^\\/[^/]+\\/session(\\/[^/]+)?$",
      "^\\/(?!doc$)[A-Za-z0-9_-]+$",
    ])
  })
})

// Drift guard: the allowlist content tests above only prove `./pwa` is correct.
// They do NOT prove `vite.config.ts` still CONSUMES the shared constant. Without
// this guard, a future re-inline of the literal would leave `pwa.ts` as dead
// code while every test stays green (the regression class from plan 85). These
// tests read the vite config source and assert it imports — and does not
// re-inline — the shared allowlist.
describe("vite.config.ts navigateFallbackAllowlist wiring", () => {
  const viteConfigSource = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8")

  test("imports navigateFallbackAllowlist from ./src/pwa", () => {
    expect(viteConfigSource).toMatch(
      /import\s*\{[^}]*\bnavigateFallbackAllowlist\b[^}]*\}\s*from\s*["']\.\/src\/pwa["']/,
    )
  })

  test("does not re-inline a navigateFallbackAllowlist array literal", () => {
    expect(viteConfigSource).not.toMatch(/navigateFallbackAllowlist\s*:\s*\[/)
  })
})
