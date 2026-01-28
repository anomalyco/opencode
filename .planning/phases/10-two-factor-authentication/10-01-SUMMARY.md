---
phase: 10
plan: 01
subsystem: authentication
tags: [2fa, totp, otp, pam, config]
requires:
  - 03-auth-broker-core
provides:
  - 2fa-config-schema
  - otp-detection
  - otp-validation
affects:
  - 10-02 # 2FA UI and flow
tech-stack:
  added: []
  patterns:
    - pam-otp-service
key-files:
  created:
    - packages/opencode-broker/src/auth/otp.rs
    - packages/opencode-broker/service/opencode-otp.pam
    - packages/opencode-broker/service/opencode-otp.pam.macos
  modified:
    - packages/opencode/src/config/auth.ts
    - packages/opencode-broker/src/auth/mod.rs
decisions:
  - id: 10-01-01
    decision: AuthError reuse from pam module
    rationale: Consistent error handling across auth operations
  - id: 10-01-02
    decision: Separate PAM service for OTP validation
    rationale: Isolate OTP-only auth from password+OTP combined auth
  - id: 10-01-03
    decision: nullok option in PAM config
    rationale: Graceful fallback for users without 2FA configured
metrics:
  duration: 4.7 min
  completed: 2026-01-24
---

# Phase 10 Plan 01: 2FA Config and OTP Module Summary

**One-liner:** Added 2FA configuration options to AuthConfig and broker OTP module with detection and PAM-based validation.

## What Was Built

### 1. Extended AuthConfig Schema

Added five new 2FA-related configuration fields:

| Field                   | Type     | Default | Purpose                                         |
| ----------------------- | -------- | ------- | ----------------------------------------------- |
| `twoFactorEnabled`      | boolean  | false   | Enable 2FA support                              |
| `twoFactorTokenTimeout` | Duration | "5m"    | How long 2FA token valid after password success |
| `deviceTrustDuration`   | Duration | "30d"   | "Remember this device" duration                 |
| `otpRateLimitMax`       | number   | 5       | Max OTP attempts per window                     |
| `otpRateLimitWindow`    | Duration | "15m"   | OTP rate limit window                           |

### 2. Broker OTP Module (`otp.rs`)

**`has_2fa_configured(home: &str) -> bool`**

- Checks if `~/.google_authenticator` file exists
- Used to determine if user has TOTP configured
- Returns false gracefully on any file access error

**`validate_otp(pam_service: &str, username: &str, code: &str) -> Result<(), AuthError>`**

- Uses separate PAM service (`{service}-otp`)
- Spawns dedicated thread for PAM (thread-safety)
- OTP code never logged (security)
- Returns generic AuthError on failure (no enumeration)

### 3. PAM Service Files

Created `opencode-otp.pam` and `opencode-otp.pam.macos`:

- Single line: `auth required pam_google_authenticator.so nullok`
- `nullok` allows users without 2FA to skip OTP validation

## Implementation Details

### Architecture Decision: Separate OTP PAM Service

The plan calls for a separate PAM service (`opencode-otp`) rather than modifying the main `opencode` service because:

1. **Separation of concerns**: Password auth vs OTP auth are distinct steps
2. **Flexibility**: Can be enabled/disabled independently
3. **Flow control**: App controls when to trigger OTP prompt

### Thread-per-Request Model

Following the same pattern as password authentication in `pam.rs`:

- Each OTP validation spawns a dedicated thread
- PAM handles are not thread-safe when shared
- tokio oneshot channel for async integration

## Decisions Made

| ID       | Decision                             | Rationale                                              |
| -------- | ------------------------------------ | ------------------------------------------------------ |
| 10-01-01 | Reuse AuthError from pam module      | Consistent error handling, no new error types          |
| 10-01-02 | Separate `{service}-otp` PAM service | Isolate OTP-only validation from password+OTP combined |
| 10-01-03 | Use `nullok` PAM option              | Graceful fallback for users without 2FA                |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated test configs with new 2FA fields**

- **Found during:** Task 1 verification
- **Issue:** Test files had hardcoded AuthConfig objects missing new required fields
- **Fix:** Added 2FA fields with default values to test configs
- **Files modified:** csrf.test.ts, auth.test.ts, pty-auth.test.ts
- **Commits:** Included in f5a9fb21e

**2. [Rule 1 - Bug] Missing Transaction trait import**

- **Found during:** Task 2 compilation
- **Issue:** `authenticate()` method requires Transaction trait in scope
- **Fix:** Added `Transaction` to nonstick imports in `do_otp_validation()`
- **Files modified:** otp.rs
- **Commits:** Included in c32afce44

## Verification Results

| Check                  | Result                           |
| ---------------------- | -------------------------------- |
| TypeScript compiles    | Pass                             |
| Rust compiles          | Pass                             |
| Config fields present  | 5 new fields verified            |
| OTP functions exported | has_2fa_configured, validate_otp |
| PAM files created      | Both Linux and macOS             |

## Artifacts

| Artifact      | Path                                                    |
| ------------- | ------------------------------------------------------- |
| Config schema | packages/opencode/src/config/auth.ts                    |
| OTP module    | packages/opencode-broker/src/auth/otp.rs                |
| Auth module   | packages/opencode-broker/src/auth/mod.rs                |
| Linux PAM     | packages/opencode-broker/service/opencode-otp.pam       |
| macOS PAM     | packages/opencode-broker/service/opencode-otp.pam.macos |

## Commits

| Hash      | Description                                                         |
| --------- | ------------------------------------------------------------------- |
| f5a9fb21e | feat(10-01): add 2FA configuration options to AuthConfig            |
| c32afce44 | feat(10-01): add broker OTP module for 2FA detection and validation |
| 662ef552f | feat(10-01): add OTP PAM service files for Linux and macOS          |

## Next Phase Readiness

**Ready for Plan 10-02:**

- 2FA configuration fields available for runtime checks
- OTP detection function ready for auth flow integration
- OTP validation function ready for 2FA step
- PAM service files ready for installation

**Blockers/Concerns:** None
