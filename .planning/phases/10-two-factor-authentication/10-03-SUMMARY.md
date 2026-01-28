---
phase: 10
plan: 03
subsystem: auth
tags: [jwt, tokens, device-trust, 2fa]

dependency-graph:
  requires: [10-01]
  provides: [device-trust-tokens, 2fa-tokens]
  affects: [10-04, 10-05]

tech-stack:
  added: [jose]
  patterns: [jwt-signing, token-verification]

key-files:
  created:
    - packages/opencode/src/auth/device-trust.ts
    - packages/opencode/src/auth/two-factor-token.ts
  modified:
    - packages/opencode/src/auth/index.ts
    - packages/opencode/package.json

decisions:
  - id: jose-dependency
    choice: "Added jose library to opencode package"
    reason: "Required for JWT signing/verification - already used in function package"

metrics:
  duration: 2.7 min
  completed: 2026-01-24
---

# Phase 10 Plan 03: Token Utilities Summary

JWT-based token modules for device trust and 2FA intermediate tokens using jose library.

## What Was Built

### Device Trust Token Module

- `createDeviceFingerprint()`: Hashes user-agent for device identification
- `createDeviceTrustToken()`: Creates signed JWT with username, fingerprint, and version
- `verifyDeviceTrustToken()`: Validates token and checks fingerprint match

### 2FA Token Module

- `TwoFactorUserInfo` interface: Carries UNIX user info through 2FA flow
- `create2FAToken()`: Creates short-lived JWT after password validation
- `verify2FAToken()`: Validates token with optional IP binding
- `getTokenRemainingSeconds()`: Decodes token exp for UI countdown

## Key Design Points

1. **Token Version Field**: Device trust tokens include `ver` for future global revocation
2. **IP Binding**: 2FA tokens optionally bind to IP address for added security
3. **Stateless Design**: All user info embedded in token - no server state needed
4. **Short Expiration**: 2FA tokens meant for 5-minute window (configurable)

## Commits

| Hash      | Type | Description                          |
| --------- | ---- | ------------------------------------ |
| ff8071414 | feat | Add device trust token module        |
| 062a3b5a3 | feat | Add 2FA token module                 |
| 8ded4b622 | feat | Export token modules from auth index |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added jose dependency to opencode package**

- **Found during:** Task 1
- **Issue:** jose library not in opencode package.json, TypeScript compilation failed
- **Fix:** Added jose@6.1.3 to dependencies using `bun add jose`
- **Files modified:** packages/opencode/package.json, bun.lock
- **Commit:** ff8071414

## Files Changed

| File                                           | Change   | Purpose                      |
| ---------------------------------------------- | -------- | ---------------------------- |
| packages/opencode/src/auth/device-trust.ts     | Created  | Device trust token utilities |
| packages/opencode/src/auth/two-factor-token.ts | Created  | 2FA token utilities          |
| packages/opencode/src/auth/index.ts            | Modified | Export new modules           |
| packages/opencode/package.json                 | Modified | Add jose dependency          |

## Verification Results

- TypeScript compiles: PASS
- Exports in index.ts: PASS
- Function signatures correct: PASS

## Next Phase Readiness

Ready for 10-04 (2FA login routes) and 10-05 (device trust routes):

- Token creation functions available for route handlers
- Token verification functions available for auth middleware
- All exports accessible via `@/auth`
