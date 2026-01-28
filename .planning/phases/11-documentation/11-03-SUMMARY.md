---
phase: 11-documentation
plan: 03
subsystem: documentation
tags: [docs, troubleshooting, pam, flowcharts, mermaid]
requires: []
provides:
  - "Troubleshooting guide with diagnostic flowcharts"
  - "Common issue solutions for auth failures"
  - "PAM debug logging instructions"
  - "Broker status checking guide"
affects: []
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - docs/troubleshooting.md
  modified: []
decisions: []
metrics:
  duration: 4.2min
  completed: 2026-01-25
---

# Phase 11 Plan 03: Troubleshooting Guide Summary

**One-liner:** Comprehensive troubleshooting guide with Mermaid flowcharts for diagnosing login failures, broker issues, and WebSocket problems.

## What Was Done

Created `docs/troubleshooting.md` (1,214 lines) with comprehensive troubleshooting guidance for authentication issues.

### Diagnostic Flowcharts

Three Mermaid flowcharts provide systematic diagnostic paths:

1. **Login Fails Flowchart** - Decision tree from error message to resolution (auth failed, connection refused, rate limited, CSRF error)
2. **Broker Issues Flowchart** - Service status → socket existence → connectivity → log analysis
3. **WebSocket Issues Flowchart** - Timeout patterns → header configuration → proxy chain verification

### Common Issues Documented

Nine common issues with consistent symptom/cause/debug/solution format:

1. **"Authentication failed" - Generic Error** - PAM auth failure with debug logging instructions
2. **"Connection refused" - Broker Not Running** - Service status checks and startup procedures
3. **"502 Bad Gateway" - nginx Can't Connect** - Proxy configuration and SELinux troubleshooting
4. **WebSocket Drops After 60 Seconds** - nginx proxy_read_timeout configuration
5. **Rate Limited When You Shouldn't Be** - IP detection and trustProxy configuration
6. **CSRF Token Error** - Cookie handling and browser settings
7. **2FA Code Always Invalid** - Time sync and PAM configuration
8. **SELinux Blocking nginx** - httpd_can_network_connect setsebool configuration
9. **macOS PAM "Operation not permitted"** - TCC Full Disk Access permissions

### PAM Debug Logging

Detailed instructions for enabling PAM debug logging on both platforms:

- Linux: Adding `debug` flag to PAM config, rsyslog configuration, rate limiting disable
- macOS: Unified logging system with `log stream` and Console.app
- Example debug output for various failure scenarios
- Instructions for removing debug logging after troubleshooting

### Broker Status Checking

Platform-specific broker management:

- **Linux (systemd):** `systemctl status`, `journalctl` logs, socket verification, start/stop commands
- **macOS (launchd):** `launchctl list`, `log show`, socket verification, load/unload commands
- Socket connection testing with `nc` and `socat`
- Common broker startup issues and solutions

### Cross-References

- Links to `pam-config.md` for detailed PAM configuration
- References to reverse proxy documentation for nginx/WebSocket issues
- Links to GitHub issues and discussions for getting help

## Tasks Completed

| Task | Description                                  | Commit    |
| ---- | -------------------------------------------- | --------- |
| 1    | Create troubleshooting guide with flowcharts | a1702b2d1 |

## Verification Results

- [x] docs/troubleshooting.md created (1,214 lines)
- [x] 3 Mermaid flowcharts render correctly
- [x] 9 common issues documented (exceeds 8+ requirement)
- [x] Each issue has symptom/cause/solution format
- [x] PAM debug logging documented for Linux and macOS
- [x] Broker troubleshooting documented for systemd and launchd
- [x] nginx/WebSocket issues covered
- [x] Platform-specific issues covered (SELinux, macOS TCC)
- [x] Cross-reference to pam-config.md included

## Success Criteria Met

1. ✅ User can follow flowchart to diagnose login failures
2. ✅ User can enable PAM debug logging and read output
3. ✅ User can check and troubleshoot broker status
4. ✅ User can resolve common nginx/WebSocket issues
5. ✅ User can handle SELinux and macOS-specific problems

## Deviations from Plan

None - plan executed exactly as written.

## Key Features

**Systematic Diagnosis:**

- Flowcharts provide visual decision trees for common problems
- Each path leads from symptom to specific resolution
- Covers authentication, connection, and configuration issues

**Platform Coverage:**

- Linux (systemd, rsyslog, SELinux)
- macOS (launchd, unified logging, TCC)
- Distribution-specific variations (Debian/Ubuntu vs RHEL/CentOS)

**Progressive Disclosure:**

- Quick diagnostic flowcharts for experts
- Detailed issue descriptions for newcomers
- Example commands for each platform
- Real log output examples for pattern recognition

**Security-Conscious:**

- Explains why errors are generic (user enumeration prevention)
- Shows how to debug without compromising security
- Instructions for removing debug logging after troubleshooting

## Next Phase Readiness

**For Plan 11-04 (Documentation Index):**

- troubleshooting.md ready to link from docs/README.md
- Cross-references to pam-config.md will work when 11-02 completes
- File provides comprehensive troubleshooting coverage per DOC-02 requirement

**Documentation Structure:**

```
docs/
└── troubleshooting.md (1,214 lines)
    ├── Diagnostic flowcharts (3)
    ├── Common issues (9)
    ├── PAM debug logging (Linux + macOS)
    ├── Broker status checking (systemd + launchd)
    └── Getting help section
```

## Implementation Notes

**Mermaid Flowcharts:**

- Used flowchart TD (top-down) for readability
- Decision nodes use diamond shapes `{question?}`
- Action nodes use rectangles `[action]`
- Clear paths from symptom to resolution

**Consistency Patterns:**

- Each issue follows: Symptom → Cause → Debug Steps → Common Causes → Solution
- Platform-specific sections use "Linux" and "macOS" headers
- Commands include both distributions where syntax differs
- All file paths use absolute paths from root

**Cross-Platform Considerations:**

- Log locations differ: `/var/log/auth.log` vs unified logging
- Service managers differ: systemd vs launchd
- Socket paths differ: `/run` vs `/var/run`
- PAM modules differ: pam_unix.so vs pam_opendirectory.so

## Performance

Duration: 4.2 minutes

- File creation and content writing: ~3 min
- Cross-reference verification: ~1 min
- Commit and verification: ~0.2 min

## Related Work

**Complements:**

- 11-02 (PAM Configuration) - Detailed setup guide
- 11-01 (Reverse Proxy) - nginx configuration for WebSocket issues

**Resolves Requirements:**

- DOC-02: "Comprehensive documentation for PAM configuration and troubleshooting"
- Troubleshooting portion of DOC-02 requirement

## Learnings

**Troubleshooting Documentation Principles:**

1. Start with visual flowcharts - faster pattern recognition
2. Consistent issue format - users know where to find information
3. Platform tabs/sections - avoid confusion between OS differences
4. Real log output - users can match patterns in their logs
5. Progressive disclosure - quick paths for experts, details for newcomers

**Common Auth Issue Patterns:**

- Most issues are configuration/setup, not code bugs
- Platform differences cause majority of confusion
- Time synchronization critical for 2FA
- Proxy configuration most complex aspect (WebSocket + headers)
- Permission issues common on locked-down systems (SELinux, TCC)
