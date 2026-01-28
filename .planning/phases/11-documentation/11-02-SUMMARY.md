---
phase: 11-documentation
plan: 02
subsystem: documentation
tags: [pam, authentication, 2fa, ldap, broker, systemd, launchd, security]
requires:
  - 10-08 # Two-factor authentication complete - document 2FA setup
  - 03-04 # Broker systemd/launchd services created
  - 01-03 # PAM config validation established
provides:
  - Comprehensive PAM configuration documentation
  - Linux systemd setup guide
  - macOS launchd setup guide
  - Two-factor authentication setup instructions
  - LDAP/SSSD integration guidance
  - Broker troubleshooting guide
  - Auth config reference table
affects:
  - 11-04 # README may link to this PAM guide
  - 12-01 # Server-side TOTP registration will extend this guide
tech-stack:
  added: []
  patterns:
    - Progressive disclosure (quick start + detailed explanations)
    - Platform-specific documentation (Linux/macOS)
    - Copy-paste friendly configuration examples
decisions:
  - decision: Progressive disclosure pattern for documentation
    rationale: PAM experts need quick start, newcomers need detailed explanation
    impact: Dual-format documentation serving multiple audience levels
  - decision: Separate OTP PAM service
    rationale: Allows independent password and OTP validation with nullok option
    impact: Users without 2FA can authenticate while 2FA is enabled
  - decision: SSSD recommended over pam_ldap.so
    rationale: Modern, maintained, better performance, offline support
    impact: Enterprise users should configure SSSD + pam_sss.so
  - decision: Document TCC requirements for macOS
    rationale: macOS Monterey+ requires Full Disk Access for PAM operations
    impact: macOS users need to grant permissions or authentication fails
key-files:
  created:
    - docs/pam-config.md
  modified: []
duration: 195
completed: 2026-01-25
---

# Phase 11 Plan 02: PAM Configuration Guide Summary

**One-liner:** Comprehensive PAM setup guide covering basic password auth, 2FA with google-authenticator, LDAP/SSSD integration, and opencode-broker configuration for Linux and macOS.

## What Was Built

Created complete PAM configuration documentation (`docs/pam-config.md`, 1065 lines) with:

1. **Quick Start** - Minimal steps for PAM experts to get authentication working
2. **PAM Fundamentals** - Explanation of PAM architecture, module types, and control flags
3. **Linux Setup** - systemd service configuration with detailed explanations
4. **macOS Setup** - launchd configuration with Open Directory and TCC considerations
5. **Two-Factor Authentication** - Complete 2FA setup with pam_google_authenticator
6. **LDAP/AD Integration** - SSSD-based enterprise authentication guidance
7. **Broker Architecture** - Deep dive into opencode-broker security model and troubleshooting
8. **Configuration Reference** - Complete table of all auth config options

## Technical Decisions

### Progressive Disclosure Documentation Pattern

**Decision:** Structure documentation with "quick start" followed by detailed explanations.

**Rationale:**

- PAM experts need minimal steps without exposition
- Newcomers need detailed explanation of concepts
- Single document serves both audiences without duplication

**Implementation:**

- Quick start section at top (copy-paste commands)
- Detailed sections follow with explanations
- Cross-references link quick start to detailed sections

### Two-Step 2FA Authentication Flow

**Decision:** Document separate PAM services for password (`opencode`) and OTP (`opencode-otp`).

**Rationale:**

- Allows `nullok` option for gradual 2FA adoption
- Users without 2FA configured can still authenticate
- Independent configuration of password vs. OTP modules

**Implementation:**

- `/etc/pam.d/opencode` - password validation
- `/etc/pam.d/opencode-otp` - OTP validation (with nullok)
- Broker validates password first, then OTP if configured

### SSSD Over Legacy pam_ldap

**Decision:** Recommend SSSD + pam_sss.so for LDAP/AD integration.

**Rationale:**

- Modern, actively maintained
- Better performance (caching)
- Offline authentication support
- Kerberos integration built-in

**Documentation approach:**

- Brief overview of SSSD benefits
- Point to distribution-specific guides (don't duplicate)
- Show PAM configuration example with pam_sss.so

### Platform-Specific TCC Documentation

**Decision:** Document macOS Full Disk Access requirements for broker.

**Rationale:**

- macOS Monterey+ enforces TCC for PAM operations
- Undocumented requirement causes cryptic permission errors
- Users need explicit instructions to grant access

**Implementation:**

- Dedicated macOS considerations section
- Step-by-step instructions for System Settings
- Troubleshooting section covers TCC permission errors

## Implementation Highlights

### Control Flags Explanation

Detailed explanation of PAM control flags with examples:

```
auth    sufficient    pam_unix.so
auth    required      pam_deny.so
```

vs.

```
auth    required      pam_deny.so
auth    sufficient    pam_unix.so
```

Shows how **order matters** - `sufficient` flag short-circuits on success, so must come before restrictive modules.

### Dual Platform Coverage

Every setup section includes both Linux and macOS:

- **Linux:** systemd service, pam_unix.so, /run/opencode/broker.sock
- **macOS:** launchd plist, pam_opendirectory.so, TCC permissions

Platform-specific differences clearly marked with headers/tabs.

### Configuration Reference Table

Complete table of all `AuthConfig` options from `packages/opencode/src/config/auth.ts`:

| Option             | Type    | Default | Description           |
| ------------------ | ------- | ------- | --------------------- |
| `enabled`          | boolean | `false` | Enable authentication |
| `twoFactorEnabled` | boolean | `false` | Enable 2FA support    |
| ...                | ...     | ...     | ...                   |

Includes:

- All 24 configuration options
- Types, defaults, descriptions
- Example configurations for different use cases

### Troubleshooting Guide

Comprehensive broker troubleshooting:

1. **Broker won't start** - Check systemd/launchd status and logs
2. **Socket doesn't exist** - Verify RuntimeDirectory and permissions
3. **Authentication fails** - Test PAM directly with pamtester
4. **Permission denied** - macOS TCC, Linux SELinux/AppArmor guidance

Each issue includes:

- Diagnostic commands
- Common causes
- Resolution steps

### Security Considerations Section

Documents security model and best practices:

- **PAM service isolation** - Why dedicated PAM file matters
- **Socket permissions** - Why 0666 is safe (PAM validates all requests)
- **Rate limiting** - IP-based protection before PAM
- **Allowed users** - Restricting authentication to specific users
- **HTTPS enforcement** - Three modes (off/warn/block)
- **Session security** - CSRF, HttpOnly, SameSite, binding

## File Structure

```
docs/
└── pam-config.md  # 1065 lines, comprehensive PAM guide
```

## Testing & Verification

Verified all must-haves:

- [x] Quick start section exists for PAM experts
- [x] Control flags explained with order-matters example
- [x] Linux setup documented with systemd service
- [x] macOS setup documented with launchd and TCC
- [x] 2FA setup with pam_google_authenticator documented
- [x] LDAP/SSSD integration mentioned with distribution links
- [x] Broker details and troubleshooting documented
- [x] Configuration reference table included (24 options)

Verified key links:

- [x] References `opencode.pam` (6 occurrences)
- [x] References `opencode-broker.service` (7 occurrences)
- [x] References auth config options from auth.ts

Document exceeds minimum 400 lines (1065 lines).

## Deviations from Plan

None - plan executed exactly as written.

## Lessons Learned

### Documentation for Multiple Audiences Works

Progressive disclosure pattern successfully serves both experts and newcomers:

- Experts can skim quick start and be done in 2 minutes
- Newcomers can read detailed explanations without overwhelm
- Cross-references connect the two levels seamlessly

### Platform Differences Need Explicit Callouts

macOS users face unique challenges (TCC, system updates resetting PAM):

- Clear platform headers prevent confusion
- macOS-specific considerations prevent support burden
- Side-by-side comparisons show conceptual equivalence

### Copy-Paste Configuration Reduces Friction

Including full configuration files inline:

- Users can verify their setup matches expected
- Reduces "what should my file look like?" questions
- Annotated explanations teach while showing working examples

## Next Phase Readiness

**Ready for:**

- Phase 12 (Server-Side TOTP Registration) - Can extend 2FA section with server-generated secrets
- Phase 11-04 (README) - Can link to this comprehensive PAM guide

**Dependencies satisfied:**

- Two-factor authentication documented (phase 10 complete)
- Broker services documented (phase 3 artifacts exist)
- Auth config reference complete

**No blockers identified.**

## Metrics

- **Duration:** 195 seconds (3.25 minutes)
- **Lines of code:** 1065 (documentation)
- **Files created:** 1
- **Commits:** 1 (b85c27f33)

## Artifacts

**Documentation:**

- `docs/pam-config.md` - Comprehensive PAM configuration guide

**Commit:**

- `b85c27f33` - docs(11-02): create comprehensive PAM configuration guide
