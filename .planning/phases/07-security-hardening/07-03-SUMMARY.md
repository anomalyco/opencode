---
phase: 07-security-hardening
plan: "03"
subsystem: server-security
tags: [https, security, login, http-detection, warnings]
dependency-graph:
  requires:
    - "07-01" # CSRF protection
    - "06-01" # Login page
  provides:
    - https-detection-utilities
    - http-warning-banner
    - require-https-enforcement
  affects:
    - future phases: HTTPS-aware features can use these utilities
tech-stack:
  added: []
  patterns:
    - connection-security-detection
    - proxy-protocol-handling
    - conditional-ui-rendering
key-files:
  created:
    - packages/opencode/src/server/security/https-detection.ts
    - packages/opencode/test/server/security/https-detection.test.ts
  modified:
    - packages/opencode/src/server/routes/auth.ts
    - packages/opencode/test/server/routes/auth.test.ts
decisions:
  - id: https-localhost-exemption
    choice: "Always allow localhost over HTTP regardless of requireHttps setting"
    rationale: "Developer experience - HTTPS on localhost is unnecessary and cumbersome"
  - id: x-forwarded-proto-trust
    choice: "trustProxy config controls whether to honor X-Forwarded-Proto header"
    rationale: "Security - only trust proxy headers when explicitly configured"
  - id: sessionStorage-warning-dismissal
    choice: "Use sessionStorage for warning dismissal persistence"
    rationale: "Persists during login session but not across browser restarts - appropriate for security warnings"
  - id: block-disables-form
    choice: "When requireHttps is 'block', disable all form inputs and hide submit button"
    rationale: "Clear UX - form is not functional, provides clear error message"
metrics:
  duration: 6.4 min
  completed: 2026-01-22
---

# Phase 07 Plan 03: HTTPS Detection and HTTP Warning Summary

**One-liner:** Detects HTTP/HTTPS connections with configurable warning banners and blocking enforcement on the login page.

## What Was Built

### 1. HTTPS Detection Utilities

**File:** `packages/opencode/src/server/security/https-detection.ts`

Core detection functions:

- **`isLocalhost(c: Context)`** - Detects localhost connections (localhost, 127.0.0.1, ::1, [::1])
- **`isSecureConnection(c: Context, trustProxy: boolean)`** - Checks HTTPS via protocol or X-Forwarded-Proto
- **`shouldBlockInsecureLogin(c: Context, config)`** - Determines if HTTP login should be blocked
- **`getConnectionSecurityInfo(c: Context, config)`** - Comprehensive security context for UI

**Key behaviors:**
- Localhost always allowed over HTTP (developer-friendly)
- X-Forwarded-Proto respected when trustProxy enabled (reverse proxy support)
- Three modes: off (no checks), warn (show banner), block (disable login)

### 2. Login Page HTTP Warning

**File:** `packages/opencode/src/server/routes/auth.ts`

Dynamic login page generation with security context:

**Warning mode (`requireHttps: "warn"`):**
- Yellow/amber banner: "You are connecting over HTTP. Your credentials may be visible to attackers on this network."
- "I understand the risks" dismissal button
- sessionStorage persistence (warning hidden for session after dismissal)

**Block mode (`requireHttps: "block"`):**
- All form inputs disabled (`<input disabled>`)
- Submit button hidden
- Prominent red error: "HTTPS is required to log in. Please access this page over a secure connection."
- Grayed-out disabled styling

**POST /login enforcement:**
- Check `shouldBlockInsecureLogin` before processing login
- Return 403 with `https_required` error when blocked
- Log security event for audit trail

### 3. Comprehensive Test Coverage

**Files:**
- `packages/opencode/test/server/security/https-detection.test.ts` (21 tests)
- `packages/opencode/test/server/routes/auth.test.ts` (8 new integration tests)

**Test categories:**
- Localhost detection (all variations)
- HTTPS detection (protocol + X-Forwarded-Proto)
- Blocking logic (all requireHttps modes)
- GET /login HTML generation (warning/block/normal)
- POST /login enforcement
- trustProxy configuration respect

## Technical Approach

### Connection Security Detection

Three-layer check:
1. **Localhost check** - If localhost, always allow
2. **Proxy header check** - If trustProxy, honor X-Forwarded-Proto
3. **Direct protocol check** - Parse URL protocol

This ordering ensures developer ergonomics (localhost first) while supporting production reverse proxies.

### Dynamic HTML Generation

Converted static login HTML to function:

```typescript
function generateLoginPageHtml(securityContext: {
  shouldWarn: boolean
  shouldBlock: boolean
  isSecure: boolean
}): string
```

Conditional rendering via template literals:
- `${shouldBlock ? '<div class="blocked-message">...' : ''}`
- `${shouldWarn ? '<div id="httpWarning">...' : ''}`
- `${shouldBlock ? 'disabled' : ''}`

### sessionStorage Pattern

JavaScript manages warning dismissal:

```javascript
// Check on page load
if (httpWarning && sessionStorage.getItem('http-warning-dismissed')) {
  httpWarning.classList.add('hidden');
}

// Set on dismiss
sessionStorage.setItem('http-warning-dismissed', 'true');
```

This persists during the login flow but resets on new browser session - appropriate security warning UX.

## Decisions Made

### 1. Localhost HTTP Exemption

**Decision:** Always allow localhost over HTTP regardless of `requireHttps` setting.

**Rationale:**
- Developer experience - local HTTPS setup is cumbersome and unnecessary
- Security acceptable - localhost traffic doesn't traverse network
- Aligns with web development best practices

**Implementation:** First check in `shouldBlockInsecureLogin` returns false for localhost.

### 2. trustProxy Configuration

**Decision:** Only honor X-Forwarded-Proto header when `trustProxy: true` in config.

**Rationale:**
- Security risk - untrusted proxy headers can be spoofed by attackers
- Explicit opt-in required for reverse proxy deployments
- Follows express.js trust proxy pattern

**Implementation:** `isSecureConnection` checks trustProxy before reading header.

### 3. sessionStorage for Warning Dismissal

**Decision:** Store warning dismissal in sessionStorage, not localStorage or cookies.

**Rationale:**
- Session-scoped persistence appropriate for security warnings
- User must re-acknowledge on new browser session
- Doesn't clutter localStorage with persistent flags
- No server-side state needed

**Implementation:** JavaScript checks `sessionStorage.getItem('http-warning-dismissed')` on page load.

### 4. Disabled Form UI for Block Mode

**Decision:** When `requireHttps: "block"`, disable all inputs and hide submit button.

**Rationale:**
- Clear UX - form is visibly non-functional
- Prevents user confusion (typing in disabled form)
- Error message provides clear action (use HTTPS)
- Submit button removal emphasizes blocking

**Implementation:** Template conditionally adds `disabled` attributes and removes submit button.

## Integration Points

### From Previous Plans

**07-01 (CSRF Protection):**
- HTTPS detection checks run after CSRF validation in login flow
- Both security layers complement each other

**06-01 (Login Page):**
- Extended existing login page with security context
- Maintained visual design and UX patterns

### Configuration System

**01-01-03 (Auth Config):**
- Uses existing `requireHttps` and `trustProxy` config fields
- Config already validated at startup

### For Future Plans

**Any HTTPS-aware features:**
- Reusable `https-detection.ts` utilities
- Pattern established for security context checking
- Can extend for other endpoints beyond login

## Deviations from Plan

None - plan executed exactly as written.

## Testing Approach

### Unit Tests (https-detection.test.ts)

**Mock context pattern:**
```typescript
function mockContext(url: string, headers: Record<string, string>): Context
```

Allows precise control of URL and headers for deterministic testing.

**Coverage:**
- All localhost variations (localhost, 127.0.0.1, ::1, [::1], with/without ports)
- HTTPS detection with protocol and X-Forwarded-Proto
- All requireHttps modes (off, warn, block)
- trustProxy behavior (enabled/disabled)

### Integration Tests (auth.test.ts)

**Full request/response cycle:**
- GET /login HTML generation with security context
- POST /login enforcement of requireHttps
- trustProxy configuration respected end-to-end

**Test assertions:**
- HTML contains `id="httpWarning"` when warning shown
- HTML contains "HTTPS is required" when blocked
- POST returns 403 `https_required` when blocked
- Localhost always works even in block mode

## Performance Characteristics

**Runtime overhead:** Negligible
- Simple string comparisons for localhost detection
- Single URL parse for protocol check
- Header lookup when trustProxy enabled

**No additional dependencies:** Uses only Hono Context API.

## Security Considerations

### Protection Provided

**User awareness:**
- Visible warning when credentials sent over HTTP
- Cannot proceed without explicit acknowledgment (warn mode)
- Completely blocked in strict mode

**Admin control:**
- Three enforcement levels (off/warn/block)
- Per-deployment configuration
- Localhost exemption for development

### Limitations

**Not a complete solution:**
- Relies on client-side enforcement (can be bypassed with direct API calls)
- POST /login does enforce server-side, but warning is UI-only
- No protection for other endpoints (scope limited to login)

**Proxy header trust:**
- X-Forwarded-Proto can be spoofed if trustProxy misconfigured
- Admin must ensure proxy sets headers correctly

### Future Hardening

**Potential improvements:**
- HSTS header enforcement (Strict-Transport-Security)
- Redirect HTTP to HTTPS automatically
- Rate limit HTTP login attempts more aggressively
- Extend enforcement to all auth endpoints

## Next Phase Readiness

**Phase complete - no blockers identified.**

All security hardening features implemented:
- CSRF protection (07-01)
- Rate limiting (07-02)
- HTTPS detection and enforcement (07-03)

Ready to proceed to subsequent phases.

## Lessons & Observations

### sessionStorage Pattern

sessionStorage proved ideal for dismissible security warnings:
- Persists during multi-step flows (login attempt)
- Resets on new session (forces re-acknowledgment)
- No server-side state management needed

This pattern applicable to other transient UI warnings.

### Localhost Exemption Necessity

Always-allow localhost critical for developer experience:
- Local HTTPS certificate setup is significant friction
- No security benefit for loopback traffic
- Industry standard practice (browsers, frameworks)

### trustProxy Configuration

Explicit proxy trust configuration prevents security misconfiguration:
- Default (false) is secure-by-default
- Requires admin to understand deployment topology
- Clear in config what headers are trusted

This pattern should extend to other proxy-related headers (X-Forwarded-For, X-Real-IP).

---

**Summary:** HTTPS detection with user-friendly warning system and strict enforcement mode. Localhost-friendly for development, proxy-aware for production deployments. Comprehensive test coverage ensures correct behavior across all modes.
