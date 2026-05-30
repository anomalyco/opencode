/**
 * Unit tests for the Claude OAuth refresh shim.
 *
 * Covers:
 *   - Fresh token (expiresAt > now + buffer) returns as-is, NO network call
 *   - Expired token triggers refresh, file gets rewritten with new tokens
 *   - 4xx refresh response → null return, file untouched
 *   - Network error on refresh → null return, file untouched
 *   - Missing file → null return
 *   - Flat-shape (no expiresAt + no claudeAiOauth wrapping) → null return
 *   - Concurrent calls dedupe to a single fetch
 *
 * Mocks Bun's global `fetch` to avoid hitting Anthropic's real OAuth
 * endpoint.  Per-test reset via `_resetInFlightForTest()` so the in-flight
 * Promise from a previous test doesn't leak.
 */

import { expect, test, describe, beforeEach, afterEach, afterAll } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  ensureFreshClaudeToken,
  _resetInFlightForTest,
  _readCredsForTest,
  _statCredsForTest,
} from "./claude-token-refresh"

// ── Fixtures ───────────────────────────────────────────────────────────────

const VALID_ACCESS = "sk-ant-oat01-" + "a".repeat(60)
const REFRESHED_ACCESS = "sk-ant-oat01-" + "b".repeat(60)
const VALID_REFRESH = "sk-ant-ort01-" + "c".repeat(60)
const ROTATED_REFRESH = "sk-ant-ort01-" + "d".repeat(60)

function makeKeychainCreds(opts: { accessToken?: string; refreshToken?: string; expiresAt?: number }) {
  return {
    claudeAiOauth: {
      accessToken: opts.accessToken ?? VALID_ACCESS,
      refreshToken: opts.refreshToken ?? VALID_REFRESH,
      expiresAt: opts.expiresAt ?? Date.now() + 3600_000, // 1 hour out
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "team",
      rateLimitTier: "default_claude_max_5x",
    },
    mcpOAuth: {
      "plugin:design:figma|d39d3b6252bc1ac5": {
        serverName: "plugin:design:figma",
        clientId: "test-client",
      },
    },
  }
}

// ── Test harness ───────────────────────────────────────────────────────────

let tempDir: string
let credsPath: string
let originalFetch: typeof fetch
let originalEnv: { CLAUDE_CREDENTIALS_PATH?: string }

beforeEach(() => {
  // Fresh tempdir per test so file mtimes / cross-test pollution stays bounded.
  tempDir = mkdtempSync(join(tmpdir(), "claude-token-refresh-test-"))
  credsPath = join(tempDir, "claude-credentials.json")

  // Point the module at this tempdir's file.
  originalEnv = { CLAUDE_CREDENTIALS_PATH: process.env["CLAUDE_CREDENTIALS_PATH"] }
  process.env["CLAUDE_CREDENTIALS_PATH"] = credsPath

  // Stub fetch so no real OAuth round-trip ever happens during tests.
  originalFetch = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error("fetch not mocked for this test — should have been overridden in the test body")
  }) as unknown as typeof fetch

  _resetInFlightForTest()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalEnv.CLAUDE_CREDENTIALS_PATH === undefined) {
    delete process.env["CLAUDE_CREDENTIALS_PATH"]
  } else {
    process.env["CLAUDE_CREDENTIALS_PATH"] = originalEnv.CLAUDE_CREDENTIALS_PATH
  }
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

afterAll(() => {
  // Restore fetch one final time in case afterEach didn't run for some reason.
  globalThis.fetch = originalFetch
})

function setFetchMock(impl: (req: { url: string; body: string }) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const body = typeof init?.body === "string" ? init.body : ""
    return impl({ url, body })
  }) as unknown as typeof fetch
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ensureFreshClaudeToken — happy paths", () => {
  test("returns existing token when valid + far from expiry, NO fetch", async () => {
    // Token expires in 1 hour — well past the 60s buffer.
    writeFileSync(credsPath, JSON.stringify(makeKeychainCreds({})))
    let fetchCalled = false
    setFetchMock(() => {
      fetchCalled = true
      return new Response("should not be called", { status: 500 })
    })

    const result = await ensureFreshClaudeToken()
    expect(result).toBe(VALID_ACCESS)
    expect(fetchCalled).toBe(false)
  })

  test("refreshes when expiresAt is in the past, writes new tokens to disk", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )
    const mtimeBefore = _statCredsForTest()!.mtimeMs

    setFetchMock(({ url, body }) => {
      expect(url).toContain("oauth/token")
      const parsed = JSON.parse(body)
      expect(parsed.grant_type).toBe("refresh_token")
      expect(parsed.refresh_token).toBe(VALID_REFRESH)
      expect(parsed.client_id).toBeDefined()
      return new Response(
        JSON.stringify({
          access_token: REFRESHED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900, // 15 min — Anthropic's typical
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })

    const result = await ensureFreshClaudeToken()
    expect(result).toBe(REFRESHED_ACCESS)

    // File contents updated.
    const onDisk = _readCredsForTest()!
    expect(onDisk.claudeAiOauth?.accessToken).toBe(REFRESHED_ACCESS)
    expect(onDisk.claudeAiOauth?.refreshToken).toBe(ROTATED_REFRESH)
    expect(onDisk.claudeAiOauth?.expiresAt).toBeGreaterThan(Date.now())

    // mtime moved (defensive: tempdirs on some FSes have low resolution; if mtimeBefore===mtimeAfter
    // we'd need an extra check on content, but content already verified above).
    void mtimeBefore

    // mcpOAuth preserved through the write.
    expect((onDisk as { mcpOAuth?: unknown }).mcpOAuth).toBeDefined()
  })

  test("refreshes when expiresAt is missing entirely (pessimistic)", async () => {
    const creds = makeKeychainCreds({})
    delete (creds.claudeAiOauth as { expiresAt?: number }).expiresAt
    writeFileSync(credsPath, JSON.stringify(creds))

    setFetchMock(() =>
      new Response(
        JSON.stringify({
          access_token: REFRESHED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const result = await ensureFreshClaudeToken()
    expect(result).toBe(REFRESHED_ACCESS)
  })
})

describe("ensureFreshClaudeToken — failure paths", () => {
  test("returns null when file is missing", async () => {
    // No file written.
    let fetchCalled = false
    setFetchMock(() => {
      fetchCalled = true
      return new Response("", { status: 500 })
    })
    const result = await ensureFreshClaudeToken()
    expect(result).toBeNull()
    expect(fetchCalled).toBe(false)
  })

  test("returns null when file is not JSON", async () => {
    writeFileSync(credsPath, "this is not JSON")
    const result = await ensureFreshClaudeToken()
    expect(result).toBeNull()
  })

  test("returns null on flat-shape creds (no claudeAiOauth wrapping)", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify({ accessToken: VALID_ACCESS, refreshToken: VALID_REFRESH }),
    )
    const result = await ensureFreshClaudeToken()
    expect(result).toBeNull()
  })

  test("returns null and leaves file untouched when refresh responds 400", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )
    const contentBefore = readFileSync(credsPath, "utf8")

    setFetchMock(() =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    )

    const result = await ensureFreshClaudeToken()
    expect(result).toBeNull()

    // File content unchanged — failed refresh must not corrupt the on-disk
    // state.  Operator can re-upload via UI to recover.
    expect(readFileSync(credsPath, "utf8")).toBe(contentBefore)
  })

  test("returns null and leaves file untouched on network error", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )
    const contentBefore = readFileSync(credsPath, "utf8")

    setFetchMock(() => {
      throw new Error("ECONNREFUSED")
    })

    const result = await ensureFreshClaudeToken()
    expect(result).toBeNull()
    expect(readFileSync(credsPath, "utf8")).toBe(contentBefore)
  })

  test("returns null when refresh response is missing required fields", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )

    setFetchMock(() =>
      new Response(JSON.stringify({ access_token: "only-this" }), { status: 200 }),
    )

    const result = await ensureFreshClaudeToken()
    expect(result).toBeNull()
  })
})

describe("ensureFreshClaudeToken — concurrency", () => {
  test("N concurrent calls trigger exactly ONE fetch", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )

    let fetchCount = 0
    setFetchMock(async () => {
      fetchCount++
      // Small delay so all callers definitely arrive while a refresh is in flight.
      await new Promise((r) => setTimeout(r, 20))
      return new Response(
        JSON.stringify({
          access_token: REFRESHED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900,
        }),
        { status: 200 },
      )
    })

    const results = await Promise.all([
      ensureFreshClaudeToken(),
      ensureFreshClaudeToken(),
      ensureFreshClaudeToken(),
      ensureFreshClaudeToken(),
      ensureFreshClaudeToken(),
    ])

    expect(fetchCount).toBe(1)
    expect(results).toEqual([
      REFRESHED_ACCESS,
      REFRESHED_ACCESS,
      REFRESHED_ACCESS,
      REFRESHED_ACCESS,
      REFRESHED_ACCESS,
    ])
  })

  test("after a call settles, the NEXT call re-evaluates (does NOT cache forever)", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() + 3600_000 })),
    )

    let fetchCount = 0
    setFetchMock(() => {
      fetchCount++
      return new Response(
        JSON.stringify({
          access_token: REFRESHED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900,
        }),
        { status: 200 },
      )
    })

    // First call: token valid → no fetch.
    const r1 = await ensureFreshClaudeToken()
    expect(r1).toBe(VALID_ACCESS)
    expect(fetchCount).toBe(0)

    // Overwrite file with an expired token; second call should refresh.
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )
    const r2 = await ensureFreshClaudeToken()
    expect(r2).toBe(REFRESHED_ACCESS)
    expect(fetchCount).toBe(1)
  })
})

describe("ensureFreshClaudeToken — file persistence", () => {
  test("refresh preserves unrelated top-level fields (mcpOAuth, etc.)", async () => {
    const creds = makeKeychainCreds({ expiresAt: Date.now() - 1_000 })
    // Add an extra top-level key the module doesn't know about.
    ;(creds as { customField?: unknown }).customField = { unrelated: "data" }
    writeFileSync(credsPath, JSON.stringify(creds))

    setFetchMock(() =>
      new Response(
        JSON.stringify({
          access_token: REFRESHED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900,
        }),
        { status: 200 },
      ),
    )

    await ensureFreshClaudeToken()

    const onDisk = _readCredsForTest()!
    expect((onDisk as { customField?: unknown }).customField).toEqual({ unrelated: "data" })
    expect((onDisk as { mcpOAuth?: unknown }).mcpOAuth).toBeDefined()
  })

  test("file mode is 0600 after refresh write", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )

    setFetchMock(() =>
      new Response(
        JSON.stringify({
          access_token: REFRESHED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900,
        }),
        { status: 200 },
      ),
    )

    await ensureFreshClaudeToken()

    const mode = statSync(credsPath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test("temp file is cleaned up — no .tmp leftover after successful write", async () => {
    writeFileSync(
      credsPath,
      JSON.stringify(makeKeychainCreds({ expiresAt: Date.now() - 1_000 })),
    )

    setFetchMock(() =>
      new Response(
        JSON.stringify({
          access_token: REFRESHED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900,
        }),
        { status: 200 },
      ),
    )

    await ensureFreshClaudeToken()
    expect(existsSync(credsPath + ".tmp")).toBe(false)
  })
})
