---
phase: 03-auth-broker-core
plan: 06
subsystem: auth
tags: [cli, yargs, bun, broker-management, system-service]

# Dependency graph
requires:
  - phase: 03-auth-broker-core
    provides: BrokerClient for status checks, Rust broker binary, service files
provides:
  - CLI commands for broker management (setup, status)
  - Broker build script for npm postinstall
  - Complete auth broker infrastructure
affects: [04-web-server]

# Tech tracking
tech-stack:
  added: []
  patterns: [multi-path binary resolution, graceful build failure]

key-files:
  created:
    - packages/opencode/script/build-broker.ts
  modified:
    - packages/opencode/src/cli/cmd/auth.ts
    - packages/opencode/package.json

key-decisions:
  - "Broker subcommand under auth: opencode auth broker {setup|status}"
  - "Multi-path binary resolution: monorepo root, packages/opencode, script location"
  - "Graceful build failure: postinstall skips if Rust unavailable"

patterns-established:
  - "CLI subcommand grouping for related functionality"
  - "Platform-specific service installation (systemd vs launchd)"

# Metrics
duration: 8min
completed: 2026-01-20
---

# Phase 03 Plan 06: CLI Integration Summary

**CLI commands for broker management with setup/status subcommands and build script for postinstall**

## Performance

- **Duration:** 8 min (across checkpoint pause)
- **Started:** 2026-01-20T20:35:00Z
- **Completed:** 2026-01-20T20:43:00Z
- **Tasks:** 4
- **Files created:** 1
- **Files modified:** 2

## Accomplishments

- `opencode auth broker setup` command installs binary, PAM config, and system service
- `opencode auth broker status` command shows broker health, PAM config, and binary status
- Build script compiles Rust broker during postinstall (graceful skip if Rust unavailable)
- End-to-end broker startup verified with manual testing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create auth CLI commands** - `a7a785ea0` (feat)
2. **Task 2: Integrate auth command into CLI** - included in Task 1 commit
3. **Task 3: Create broker build script** - `fef035b3a` (chore)
4. **Task 4: Human verification** - passed with bug fix `968eb6e01` (fix)

## Files Created/Modified

- `packages/opencode/src/cli/cmd/auth.ts` - Added BrokerCommand, BrokerSetupCommand, BrokerStatusCommand with path resolution helpers
- `packages/opencode/script/build-broker.ts` - Build script that compiles Rust broker or skips gracefully
- `packages/opencode/package.json` - Added postinstall script for broker build

## Decisions Made

1. **Broker subcommand under auth** - Grouped broker management under `opencode auth broker` rather than top-level `opencode broker` to maintain logical grouping with auth-related commands.

2. **Multi-path binary resolution** - Binary lookup checks monorepo root, packages/opencode sibling, and script location paths to support both development and installed scenarios.

3. **Graceful build failure** - Build script exits 0 even on failure so npm install succeeds. Auth is an optional feature.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed broker binary path resolution**
- **Found during:** Task 4 (human verification)
- **Issue:** `findBrokerBinary()` and `findBrokerPackageDir()` were missing candidate paths for running from packages/opencode directory
- **Fix:** Added `../opencode-broker` relative path and fixed script location calculation
- **Files modified:** packages/opencode/src/cli/cmd/auth.ts
- **Verification:** `opencode auth broker status` now finds broker binary correctly
- **Committed in:** 968eb6e01

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for development workflow. No scope creep.

## Issues Encountered

None beyond the path resolution issue documented above.

## User Setup Required

None for development. Production deployment requires:
- Build broker: `cd packages/opencode-broker && cargo build --release`
- Install with: `sudo opencode auth broker setup`

## Phase 3 Completion

This plan completes Phase 3: Auth Broker Core. The phase delivered:

1. **Rust broker daemon** (03-01 through 03-03)
   - PAM authentication via nonstick crate
   - Unix socket IPC with JSON protocol
   - Rate limiting and username validation

2. **Service infrastructure** (03-04)
   - systemd service file for Linux
   - launchd plist for macOS
   - PAM config files for both platforms

3. **TypeScript client** (03-05)
   - BrokerClient with authenticate() and ping()
   - Platform-aware socket paths
   - 12-test suite

4. **CLI integration** (03-06)
   - Setup and status commands
   - Build script for npm workflow

## Next Phase Readiness

- Auth broker infrastructure complete
- BrokerClient available for login endpoint in Phase 4
- Service files ready for production deployment
- Broker binary builds and starts successfully

---
*Phase: 03-auth-broker-core*
*Completed: 2026-01-20*
