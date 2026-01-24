---
phase: 10-two-factor-authentication
plan: 07
subsystem: auth
tags: [totp, qrcode, 2fa, setup-wizard]

dependency-graph:
  requires: [10-01, 10-02, 10-04, 10-05]
  provides: [totp-setup, qr-generation, 2fa-wizard]
  affects: []

tech-stack:
  added: [qrcode]
  patterns: [totp-secret-generation, base32-encoding, qr-svg]

key-files:
  created:
    - packages/opencode/src/auth/totp-setup.ts
  modified:
    - packages/opencode/src/auth/index.ts
    - packages/opencode/src/server/routes/auth.ts
    - packages/opencode/package.json

decisions:
  - id: qrcode-svg-output
    choice: "Generate QR code as inline SVG"
    why: "No external image hosting needed, renders directly in HTML"
  - id: base32-encoding
    choice: "Custom base32 encoder"
    why: "Standard RFC 4648 base32, no extra dependency needed"
  - id: setup-command-display
    choice: "Show google-authenticator CLI command"
    why: "User must run server command to enable PAM OTP validation"

metrics:
  duration: 3.3 min
  completed: 2026-01-24
---

# Phase 10 Plan 07: 2FA Setup Wizard Summary

TOTP setup wizard with QR code generation for authenticator app enrollment.

## What Was Built

### 1. TOTP Setup Module (packages/opencode/src/auth/totp-setup.ts)
- `TotpSetupData` interface with secret, otpauth URL, and SVG QR code
- `base32Encode()` function for encoding TOTP secrets
- `generateTotpSetup()` generates 160-bit secret, builds otpauth:// URL, creates SVG QR code
- `getGoogleAuthenticatorSetupCommand()` returns CLI command for server-side setup

### 2. Setup Wizard UI (generate2FASetupPageHtml)
- Step 1: QR code display with manual secret fallback
- Step 2: Server command to run (google-authenticator CLI)
- Step 3: Verification form to confirm setup works
- Warning banner if user already has 2FA configured

### 3. Setup Wizard Endpoints
- `GET /auth/2fa/setup` - Requires authenticated session, shows wizard with fresh QR code
- `POST /auth/2fa/verify` - Validates OTP code to confirm setup is working

## Technical Details

### QR Code Generation
- Uses `qrcode` npm package for SVG output
- QR encodes otpauth:// URL per Google Authenticator spec
- 200x200 pixels, medium error correction

### TOTP Secret
- 160-bit (20 bytes) cryptographically random
- Base32 encoded for compatibility with all authenticator apps
- Displayed for manual entry if QR scanning not available

### Setup Flow
1. User visits /auth/2fa/setup (must be logged in)
2. Page generates fresh secret and QR code
3. User scans QR in authenticator app
4. User runs google-authenticator command on server with --secret flag
5. User enters 6-digit code to verify setup works
6. On next login, user will be prompted for 2FA code

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 3cfb8e7b5 | chore | Add qrcode dependency for TOTP setup |
| d21d52986 | feat | Create TOTP setup module with QR code generation |
| 9f3aa19b6 | feat | Add 2FA setup wizard endpoints and page |

## Deviations from Plan

None - plan executed exactly as written.

## Dependencies Installed

- `qrcode@1.5.4` - QR code generation
- `@types/qrcode@1.5.6` - TypeScript types

## Next Phase Readiness

2FA setup wizard is complete. Users can now:
1. Log in with password
2. Visit /auth/2fa/setup to see QR code
3. Add account to their authenticator app
4. Run server command to enable PAM OTP
5. Verify setup with a test code

The flow integrates with existing 2FA verification from Plan 10-05/10-06.
