/**
 * Unit tests for the credentials normaliser.
 *
 * Co-located with the source (vs `packages/opencode/test/...`) to match the
 * collab fork's small-fast-test convention.  Runs under bun's built-in
 * test runner.  Exercises the three accepted shapes + a handful of rejection
 * cases — the exact matrix that bit us on 2026-05-27 when keychain dumps
 * weren't recognised by the validator.
 */
import { expect, test, describe } from "bun:test"

import { _normalizeClaudeCredsForTest as normalize } from "./claude-credentials"

const VALID_ACCESS = "sk-ant-oat01-" + "x".repeat(60)
const VALID_REFRESH = "sk-ant-ort01-" + "y".repeat(60)

describe("normalizeClaudeCreds — accepted shapes", () => {
  test("Mac keychain nested shape", () => {
    const result = normalize({
      mcpOAuth: { "github|abc": { serverName: "github", accessToken: "" } },
      claudeAiOauth: {
        accessToken: VALID_ACCESS,
        refreshToken: VALID_REFRESH,
        expiresAt: 1779905758965,
        scopes: ["user:inference"],
        subscriptionType: "team",
        rateLimitTier: "default_claude_max_5x",
        email: "alice@example.com",
      },
    })
    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe(VALID_ACCESS)
    expect(result!.refreshToken).toBe(VALID_REFRESH)
    expect(result!.email).toBe("alice@example.com")
    expect(result!.wasKeychainShape).toBe(true)
  })

  test("flat camelCase shape", () => {
    const result = normalize({
      accessToken: VALID_ACCESS,
      refreshToken: VALID_REFRESH,
    })
    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe(VALID_ACCESS)
    expect(result!.refreshToken).toBe(VALID_REFRESH)
    expect(result!.email).toBeUndefined()
    expect(result!.wasKeychainShape).toBe(false)
  })

  test("flat snake_case shape (legacy OAuth spec)", () => {
    const result = normalize({
      access_token: VALID_ACCESS,
      refresh_token: VALID_REFRESH,
      email: "bob@example.com",
    })
    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe(VALID_ACCESS)
    expect(result!.refreshToken).toBe(VALID_REFRESH)
    expect(result!.email).toBe("bob@example.com")
    expect(result!.wasKeychainShape).toBe(false)
  })

  test("keychain shape preferred over flat when both present", () => {
    // Caller passes the nested keychain dump — the flat-camelCase or
    // flat-snake_case probes never fire because the keychain probe matches
    // first.  wasKeychainShape=true so the writer preserves the full payload.
    const result = normalize({
      claudeAiOauth: { accessToken: VALID_ACCESS, refreshToken: VALID_REFRESH },
      accessToken: "ignored",
      access_token: "ignored",
    })
    expect(result!.accessToken).toBe(VALID_ACCESS)
    expect(result!.wasKeychainShape).toBe(true)
  })
})

describe("normalizeClaudeCreds — rejected inputs", () => {
  test("non-object input", () => {
    expect(normalize(null)).toBeNull()
    expect(normalize("hello")).toBeNull()
    expect(normalize(42)).toBeNull()
    expect(normalize([VALID_ACCESS, VALID_REFRESH])).toBeNull()
  })

  test("empty object", () => {
    expect(normalize({})).toBeNull()
  })

  test("keychain wrapper present but no tokens inside", () => {
    expect(normalize({ claudeAiOauth: {} })).toBeNull()
    expect(normalize({ claudeAiOauth: { accessToken: VALID_ACCESS } })).toBeNull()
    expect(normalize({ claudeAiOauth: { refreshToken: VALID_REFRESH } })).toBeNull()
  })

  test("token fields are wrong types", () => {
    expect(normalize({ accessToken: 123, refreshToken: VALID_REFRESH })).toBeNull()
    expect(normalize({ access_token: null, refresh_token: VALID_REFRESH })).toBeNull()
    expect(normalize({ claudeAiOauth: { accessToken: 0, refreshToken: false } })).toBeNull()
  })

  test("only one of the two tokens present", () => {
    expect(normalize({ accessToken: VALID_ACCESS })).toBeNull()
    expect(normalize({ refreshToken: VALID_REFRESH })).toBeNull()
  })

  test("unrelated keys only", () => {
    expect(normalize({ token: VALID_ACCESS, secret: VALID_REFRESH })).toBeNull()
    expect(
      normalize({
        mcpOAuth: { "github|abc": { accessToken: VALID_ACCESS } },
      }),
    ).toBeNull()
  })
})
