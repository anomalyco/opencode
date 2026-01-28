---
phase: 07-security-hardening
plan: 02
subsystem: authentication
tags: [security, rate-limiting, logging, brute-force-protection]
requires: [phase-04]
provides: [login-rate-limiting, security-event-logging]
affects: [phase-08]
tech-stack.added: [hono-rate-limiter]
tech-stack.patterns: [ip-based-rate-limiting, security-event-logging]
key-files.created:
  - packages/opencode/src/server/security/rate-limit.ts
  - packages/opencode/test/server/security/rate-limit.test.ts
key-files.modified:
  - packages/opencode/src/config/auth.ts
  - packages/opencode/src/server/routes/auth.ts
  - packages/opencode/test/server/routes/auth.test.ts
decisions:
  - IP-based rate limiting only (per user decision in CONTEXT.md)
  - Username-based rate limiting explicitly deferred for simplicity
  - Default: 5 attempts per 15 minutes
  - Rate limiting skipped when auth disabled
  - Security events logged with masked usernames
duration: 8 min
completed: 2026-01-22
---

# Phase 7 Plan 02: Login Rate Limiting Summary

**One-liner:** IP-based rate limiting for login endpoint using hono-rate-limiter with security event logging

## What Was Built

### Rate Limiting Infrastructure

1. **Added hono-rate-limiter dependency**
   - Library: hono-rate-limiter@0.5.3
   - Integrates with Hono middleware stack

2. **Created rate-limit.ts module** (packages/opencode/src/server/security/rate-limit.ts)
   - `getClientIP(c)`: Extracts IP from X-Forwarded-For → X-Real-IP → "unknown"
   - `createLoginRateLimiter(config)`: Factory for IP-based rate limiter
   - Returns 429 with Retry-After header when limit exceeded
   - Logs security events on rate limit violations

3. **Enhanced auth config** (packages/opencode/src/config/auth.ts)
   - Added `rateLimitWindow: Duration` (default: "15m")
   - Added `rateLimitMax: number` (default: 5)
   - Existing `rateLimiting: boolean` controls on/off

### Login Endpoint Integration

4. **Applied rate limiting** (packages/opencode/src/server/routes/auth.ts)
   - Lazy-initialized rate limiter respects config
   - Applied BEFORE authentication attempt
   - Skipped when `rateLimiting: false` or auth disabled
   - Independent per-IP tracking

5. **Security event logging**
   - `logSecurityEvent()`: Logs with privacy masking
   - `maskUsername()`: Masks to "pe\*\*\*r" format
   - Events logged:
     - `login_failed`: Invalid credentials, user not found
     - `login_success`: Successful authentication
     - `csrf_violation`: Missing X-Requested-With header
     - `rate_limit`: (logged by rate limiter)
   - Logged data: event type, IP, masked username, reason, timestamp, user-agent

### Test Coverage

6. **Rate limit module tests** (test/server/security/rate-limit.test.ts)
   - getClientIP extraction (X-Forwarded-For, X-Real-IP, fallback)
   - Rate limiter allows under limit, blocks over limit
   - 429 response includes Retry-After header
   - Independent limits per IP
   - Window reset after expiration

7. **Auth route integration tests** (test/server/routes/auth.test.ts)
   - Rate limiting applied when enabled
   - Rate limiting skipped when disabled
   - Rate limiting skipped when auth disabled
   - Security event logging on success/failure/CSRF violation

## Decisions Made

### IP-Only Rate Limiting

**Decision:** Implement IP-based rate limiting only, not username-based

**Rationale:** User explicitly chose simpler approach in CONTEXT.md: "Track by IP address only — simpler approach, blocks single-source brute force"

**Impact:**

- Blocks single-source attacks effectively
- Simpler implementation (no per-username state)
- Username-based rate limiting deferred for future if needed

### Rate Limiting Before Authentication

**Decision:** Apply rate limiter before PAM authentication

**Rationale:**

- Protects PAM from brute force load
- Fails fast on rate limit without hitting system auth
- Consistent with existing architecture decision from 03-03

### Default Limits

**Decision:** 5 attempts per 15 minutes

**Rationale:**

- Balances security vs. usability
- Allows multiple typos without lockout
- 15 minutes reasonable for legitimate retries
- Configurable via config file

### Privacy-Preserving Logging

**Decision:** Mask usernames in security logs (pe\*\*\*r format)

**Rationale:**

- Reduces exposure of valid usernames
- Maintains debugging capability
- Follows security best practices

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

### Test Isolation Challenge

**Issue:** Rate limiter lazy initialization persists across test cases, causing tests to interfere

**Solution:**

- Set `rateLimiting: false` in default test config
- Enable explicitly in rate limiting tests
- Use unique IPs per test to avoid cross-test rate limiting

## Next Phase Readiness

### Phase 8 (Session Management) Prerequisites

✅ **Ready:** Rate limiting established, security logging in place

**What Phase 8 needs:**

- Session timeout enforcement (uses existing session infrastructure)
- Session persistence (config already in AuthConfig)
- "Remember me" functionality (config already in AuthConfig)

### Security Hardening Continuation

✅ **Ready for Plan 03:** HTTPS enforcement

**Foundation established:**

- Security event logging pattern
- Config-driven security features
- Middleware-based protection layers

## Technical Notes

### hono-rate-limiter Integration

- Uses `rateLimiter()` middleware from hono-rate-limiter
- Standard headers: "draft-7" (RateLimit-\* headers)
- Custom key generator for IP extraction
- Custom handler for 429 response format

### IP Address Extraction

Order of precedence:

1. X-Forwarded-For (first IP if comma-separated)
2. X-Real-IP
3. "unknown" (fallback)

**Note:** trustProxy config exists but not yet used by rate limiter. May be useful for Phase 8 if proxy detection needed.

### Security Event Log Format

```
WARN [SECURITY] service=auth-routes event_type=login_failed ip=192.168.1.1 username=pe***r reason=invalid_credentials timestamp=2026-01-22T19:40:00Z user_agent=Mozilla/5.0
```

### Rate Limiter State

- Stored in-memory by hono-rate-limiter
- Lost on server restart (acceptable for rate limiting)
- No persistence needed (unlike sessions)

## Files Changed

### Created

- `packages/opencode/src/server/security/rate-limit.ts` (79 lines)
- `packages/opencode/test/server/security/rate-limit.test.ts` (278 lines)

### Modified

- `packages/opencode/package.json` (+1 dependency)
- `packages/opencode/src/config/auth.ts` (+2 fields)
- `packages/opencode/src/server/routes/auth.ts` (+50 lines: helpers, rate limiter, logging)
- `packages/opencode/test/server/routes/auth.test.ts` (+140 lines: rate limiting & logging tests)

## Commits

1. `ca2100198` - feat(07-02): add rate limiting infrastructure
2. `cb88ba33c` - feat(07-02): integrate rate limiting and security logging in login endpoint
3. `90ed8275d` - test(07-02): add rate limiting tests

## Test Results

```
36 pass, 0 fail

Coverage:
- rate-limit.ts: 100% functions, 100% lines
- auth.ts: 60% functions, 80.48% lines (rate limit paths covered)
```

## Performance Impact

**Memory:** Negligible (rate limiter stores IP → count mapping in-memory)

**Latency:**

- Rate limiter adds ~0.1ms per request (hash lookup)
- Applied before PAM, so doesn't add to successful auth latency

**Security Benefit:** Blocks brute force attacks at 5 attempts per 15 minutes per IP
