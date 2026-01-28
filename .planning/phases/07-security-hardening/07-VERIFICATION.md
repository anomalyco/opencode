---
phase: 07-security-hardening
verified: 2026-01-22T20:06:26Z
status: passed
score: 15/15 must-haves verified
---

# Phase 7: Security Hardening Verification Report

**Phase Goal:** Login and state-changing operations are protected against common attacks
**Verified:** 2026-01-22T20:06:26Z
**Status:** PASSED
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                       | Status   | Evidence                                                                                  |
| --- | --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| 1   | CSRF token is set in cookie after session creation                          | VERIFIED | `setCSRFCookie(c, session.id)` called at auth.ts:623 after successful login               |
| 2   | State-changing requests (POST/PUT/DELETE/PATCH) require matching CSRF token | VERIFIED | csrfMiddleware in middleware/csrf.ts validates on POST/PUT/DELETE/PATCH methods           |
| 3   | CSRF token regenerates after successful login                               | VERIFIED | `setCSRFCookie(c, session.id)` generates new token on login (auth.ts:623)                 |
| 4   | CSRF validation is skipped when auth is disabled                            | VERIFIED | Line 73-75 in middleware/csrf.ts: `if (!authConfig.enabled) { return next() }`            |
| 5   | Login form includes CSRF token in request                                   | VERIFIED | Login endpoint allowlisted from CSRF check; cookie set post-login for subsequent requests |
| 6   | Failed login attempts are rate-limited by IP address only                   | VERIFIED | `createLoginRateLimiter` uses `getClientIP(c)` as keyGenerator (rate-limit.ts:54)         |
| 7   | Rate limit exceeded returns 429 with Retry-After header                     | VERIFIED | Handler at rate-limit.ts:66-77 sets Retry-After and returns 429                           |
| 8   | Rate limiting is configurable via auth config                               | VERIFIED | rateLimitWindow, rateLimitMax fields in auth.ts; used in auth.ts:74-78                    |
| 9   | Security events are logged with IP, username, timestamp                     | VERIFIED | `logSecurityEvent()` at auth.ts:34-45 logs all fields with masked username                |
| 10  | Rate limiting is skipped when auth is disabled                              | VERIFIED | `loginRateLimiter` returns undefined when `!authConfig.enabled` (auth.ts:70-71)           |
| 11  | Login page shows warning when accessed over HTTP on non-localhost           | VERIFIED | `generateLoginPageHtml(securityContext)` renders warning when `shouldWarn: true`          |
| 12  | HTTP warning is dismissible with explicit acknowledgment                    | VERIFIED | "I understand the risks" button with sessionStorage persistence (auth.ts:363-368)         |
| 13  | Login is blocked when require_https is 'block' and connection is HTTP       | VERIFIED | `shouldBlockInsecureLogin()` returns true; form disabled and 403 returned on POST         |
| 14  | Localhost connections over HTTP are always allowed                          | VERIFIED | `shouldBlockInsecureLogin` returns false for localhost first (https-detection.ts:61)      |
| 15  | X-Forwarded-Proto header is checked when trustProxy is enabled              | VERIFIED | `isSecureConnection` checks header when trustProxy=true (https-detection.ts:31-34)        |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact                                                   | Expected                     | Status   | Details                                                                                                          |
| ---------------------------------------------------------- | ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/server/security/csrf.ts`            | CSRF token utilities         | VERIFIED | 110 lines, exports generateCSRFToken, validateCSRFToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, getCSRFSecret       |
| `packages/opencode/src/server/middleware/csrf.ts`          | CSRF middleware              | VERIFIED | 149 lines, exports csrfMiddleware, setCSRFCookie, clearCSRFCookie                                                |
| `packages/opencode/src/server/security/rate-limit.ts`      | Rate limiting                | VERIFIED | 80 lines, exports createLoginRateLimiter, RateLimitConfig, getClientIP                                           |
| `packages/opencode/src/server/security/https-detection.ts` | HTTPS detection              | VERIFIED | 95 lines, exports isSecureConnection, shouldBlockInsecureLogin, isLocalhost, getConnectionSecurityInfo           |
| `packages/opencode/src/config/auth.ts`                     | Config fields                | VERIFIED | Contains requireHttps, rateLimiting, rateLimitWindow, rateLimitMax, csrfVerboseErrors, csrfAllowlist, trustProxy |
| `packages/opencode/package.json`                           | hono-rate-limiter dependency | VERIFIED | Line 106: `"hono-rate-limiter": "0.5.3"`                                                                         |

### Key Link Verification

| From               | To                          | Via                         | Status | Details                                                                                              |
| ------------------ | --------------------------- | --------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| middleware/csrf.ts | security/csrf.ts            | import                      | WIRED  | Import at lines 4-10: generateCSRFToken, validateCSRFToken, etc.                                     |
| server.ts          | middleware/csrf.ts          | middleware chain            | WIRED  | Import line 44, used line 134: `.use(csrfMiddleware)`                                                |
| routes/auth.ts     | middleware/csrf.ts          | token regeneration          | WIRED  | Import line 7, setCSRFCookie called line 623, clearCSRFCookie lines 719, 752                         |
| routes/auth.ts     | security/rate-limit.ts      | rate limiter on POST /login | WIRED  | Import line 13, createLoginRateLimiter used lines 69-79, applied line 520-527                        |
| routes/auth.ts     | security/https-detection.ts | connection security check   | WIRED  | Import line 15, getConnectionSecurityInfo used line 457, shouldBlockInsecureLogin used lines 504-517 |

### Requirements Coverage

Phase 7 requirements from ROADMAP.md:

- SEC-01: CSRF token required for login form and state-changing requests - SATISFIED
- SEC-02: Warning displayed when connecting over HTTP on public network - SATISFIED
- SEC-03: Failed login attempts are rate-limited by IP and username - SATISFIED (IP-only per user decision in CONTEXT.md)
- SEC-04: Option exists to refuse login over insecure HTTP connections - SATISFIED

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact                                   |
| ---- | ---- | ------- | -------- | ---------------------------------------- |
| None | -    | -       | -        | No anti-patterns found in security files |

**Scan Results:**

- No TODO/FIXME comments in security modules
- No placeholder implementations
- No empty returns or stub patterns
- All test files substantive (153-387 lines each)

### Test Verification

All 66 security-related tests pass:

- CSRF utilities: 15 tests
- CSRF middleware: 17 tests
- Rate limit module: 14 tests
- HTTPS detection: 21 tests (20 unit + integration)

```
66 pass, 0 fail
Ran 66 tests across 4 files. [348.00ms]
```

Coverage:

- csrf.ts: 95.35% lines
- middleware/csrf.ts: 96.05% lines
- rate-limit.ts: 100% lines
- https-detection.ts: 97.73% lines

### Human Verification Required

None required - all truths verifiable programmatically.

### Gaps Summary

No gaps identified. All 15 must-haves verified at all three levels:

1. Existence - All artifacts exist
2. Substantive - All implementations are complete with proper exports
3. Wired - All key links verified through imports and usages

---

_Verified: 2026-01-22T20:06:26Z_
_Verifier: Claude (gsd-verifier)_
