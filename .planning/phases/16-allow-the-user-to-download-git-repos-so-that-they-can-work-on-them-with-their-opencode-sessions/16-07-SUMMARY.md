---
phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions
plan: 07
subsystem: api
tags: [git, repo, validation, storage, hono]

# Dependency graph
requires:
  - phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions
    provides: Repo storage and clone workflows from earlier Phase 16 work
provides:
  - Repo record validation with invalid record errors
  - Branch list endpoint 4xx mapping for invalid repo records
affects: [16-08, repo-selector-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [Repo record validation via Zod safeParse, Storage JSON parse classified as invalid data]

key-files:
  created: []
  modified:
    - packages/opencode/src/repo/repo.ts
    - packages/opencode/src/storage/storage.ts
    - packages/opencode/src/server/routes/repo.ts

key-decisions:
  - "None - followed plan as specified"

patterns-established:
  - "Repo.get validates stored records and surfaces invalid repo errors"
  - "Branches endpoint maps invalid repo records to structured 4xx responses"

# Metrics
duration: 3 min
completed: 2026-01-28
---

# Phase 16 Plan 07: Repo Download Gaps Summary

**Repo record validation with malformed storage handling and 4xx branch errors to prevent clone/selector 500s.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-28T16:41:41Z
- **Completed:** 2026-01-28T16:44:19Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Classified malformed storage JSON as invalid repo data
- Validated repo records on load with missing-path errors
- Returned structured 4xx responses for invalid repo records in branches

## Task Commits

Each task was committed atomically:

1. **Task 1: Validate repo records and classify malformed data** - `e4ee65db8` (fix)
2. **Task 2: Map invalid repo records to 4xx in branches endpoint** - `17715aa6c` (fix)

**Plan metadata:** (docs commit for this summary)

## Files Created/Modified

- `packages/opencode/src/repo/repo.ts` - Validates repo records and reports invalid records
- `packages/opencode/src/storage/storage.ts` - Classifies malformed JSON storage data
- `packages/opencode/src/server/routes/repo.ts` - Maps invalid repo records to 4xx responses

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Repo validation gap closed; proceed with 16-08 UI gap updates
- No blockers identified for remaining Phase 16 work

---

_Phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions_
_Completed: 2026-01-28_
