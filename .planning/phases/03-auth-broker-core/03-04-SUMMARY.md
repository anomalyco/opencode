---
phase: 03-auth-broker-core
plan: 04
subsystem: infra
tags: [systemd, launchd, pam, daemon, service]

# Dependency graph
requires:
  - phase: 03-03
    provides: Unix socket server and request handler
provides:
  - systemd service file for Linux
  - launchd plist for macOS
  - PAM service configuration files
  - Platform-specific utility module
affects: [06-setup-command, 07-broker-management]

# Tech tracking
tech-stack:
  added: []
  patterns: [systemd Type=notify, launchd KeepAlive, conditional compilation for platform-specific code]

key-files:
  created:
    - packages/opencode-broker/service/opencode-broker.service
    - packages/opencode-broker/service/com.opencode.broker.plist
    - packages/opencode-broker/service/opencode.pam
    - packages/opencode-broker/service/opencode.pam.macos
    - packages/opencode-broker/src/platform/mod.rs
    - packages/opencode-broker/src/platform/linux.rs
    - packages/opencode-broker/src/platform/macos.rs
  modified:
    - packages/opencode-broker/src/lib.rs

key-decisions:
  - "systemd Type=notify for readiness signaling"
  - "launchd KeepAlive with SuccessfulExit=false for restart on failure"
  - "Separate PAM configs for Linux (pam_unix) and macOS (pam_opendirectory)"
  - "Platform module with compile-time #[cfg] for cross-platform paths"

patterns-established:
  - "Service files in service/ subdirectory of package"
  - "Platform-specific code via #[cfg(target_os)] conditional compilation"

# Metrics
duration: 2min
completed: 2026-01-20
---

# Phase 3 Plan 4: Service Files Summary

**systemd/launchd service files plus PAM configurations and platform-specific path module for cross-platform daemon support**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-20T19:24:22Z
- **Completed:** 2026-01-20T19:25:53Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- systemd service file with Type=notify, security hardening, and auto-restart
- launchd plist for macOS with restart on failure semantics
- PAM service files for Linux (pam_unix.so) and macOS (pam_opendirectory.so)
- Platform module with default_socket_path() and pam_service_source() functions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create systemd service file** - `70d8b99e3` (chore)
2. **Task 2: Create launchd plist for macOS** - `89a2a4c80` (chore)
3. **Task 3: Create PAM service file and platform module** - `03a2a4a68` (feat)

## Files Created/Modified
- `packages/opencode-broker/service/opencode-broker.service` - systemd unit file with Type=notify
- `packages/opencode-broker/service/com.opencode.broker.plist` - launchd plist for macOS
- `packages/opencode-broker/service/opencode.pam` - Linux PAM configuration
- `packages/opencode-broker/service/opencode.pam.macos` - macOS PAM configuration
- `packages/opencode-broker/src/platform/mod.rs` - Platform detection and default paths
- `packages/opencode-broker/src/platform/linux.rs` - Linux-specific placeholder
- `packages/opencode-broker/src/platform/macos.rs` - macOS-specific placeholder
- `packages/opencode-broker/src/lib.rs` - Added platform module export

## Decisions Made
- **systemd Type=notify:** Broker signals readiness via sd_notify, integrates with systemd socket activation
- **NoNewPrivileges=false:** Required because PAM may need root for reading /etc/shadow
- **launchd KeepAlive with SuccessfulExit=false:** Restart only on crash, not clean exit
- **Separate PAM files:** Linux uses pam_unix.so (shadow passwords), macOS uses pam_opendirectory.so (Open Directory)
- **Platform paths:** Linux /run/opencode, macOS /var/run/opencode, fallback /tmp/opencode

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - verification tools (systemd-analyze on macOS, plutil on Linux) gracefully skip per platform.

## User Setup Required

None - service files are templates installed by setup command (Phase 6).

## Next Phase Readiness
- All service files ready for installation by setup command
- Platform module provides correct paths for socket creation
- PAM configurations ready for both Linux and macOS
- Ready for Phase 03-06 (Final Integration)

---
*Phase: 03-auth-broker-core*
*Completed: 2026-01-20*
