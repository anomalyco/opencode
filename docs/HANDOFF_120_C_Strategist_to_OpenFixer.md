---
handoff_id: HANDOFF_120_C_Strategist_to_OpenFixer
date: 2026-03-01
decision: DECISION_120
oracle_review: PASS_2_MERGED
from: Pyxis (Strategist)
to: OpenFixer (Implementation)
phase: PHASE_1_IMPLEMENTATION
---

# OpenFixer Handoff: DECISION_120 Phase 1 - Stateless Jules Proxy

## Context Without Ceremony

OpenFixer, we are at the implementation threshold. Oracle Pass #2 merged. The 6 red lines are non-negotiable. The papertrail is perfect. We do not have time to stop, approve, confirm, applaud. We should not be stopped right now at all.

## The Mission

Implement Phase 1 of DECISION_120: **Stateless Jules Proxy Routes + Tests**

**Target Repository:** https://github.com/anomalyco/opencode  
**Branch:** dev (not main)  
**Location:** `packages/console/app/src/lib/jules/`

## Files to Create (10 new, 0 modified)

```
packages/console/app/src/lib/jules/
├── index.ts                    # Public API exports
├── types.ts                    # Jules API types
├── config.ts                   # Configuration
├── client/
│   ├── JulesClient.ts          # HTTP/REST implementation
│   ├── schemas.ts              # Zod validation schemas
│   └── errors.ts               # Jules-specific errors
├── routes/
│   └── jules.ts                # Hono route handlers (stateless)
└── __tests__/
    ├── client.test.ts          # HTTP client tests
    ├── schemas.test.ts         # Validation tests
    ├── config.test.ts          # Config tests
    └── routes.test.ts          # Route handler tests
```

## Routes to Implement

```typescript
POST /v1/jules/sessions              // Proxy to Jules API
GET  /v1/jules/sessions/:id          // Proxy to Jules API
GET  /v1/jules/sessions/:id/activities  // Proxy to Jules API
POST /v1/jules/sessions/:id/approve     // Proxy to Jules API
POST /v1/jules/sessions/:id/reject      // Proxy to Jules API
POST /v1/jules/sessions/:id/cancel      // Proxy to Jules API
GET  /v1/jules/sources               // Proxy to Jules API
```

## AGENTS.md Compliance (Red Line Verification)

Before submission, run:
```bash
grep -r "any\|try\|catch\|else {" packages/console/app/src/lib/jules/
```
**MUST return nothing.**

### Style Requirements
- No `any` type — use `unknown` + type guards
- No `try`/`catch` — use early returns + error types
- No `else` statements — early return pattern
- No destructuring — dot notation: `obj.a`, `obj.b`
- Single word names: `client`, not `julesClient`
- `const` only — no `let`, use ternaries
- Bun APIs: `Bun.file()`, `Bun.env`

## Validation Commands

```bash
# 1. Install dependencies
bun install

# 2. Type check
bun run typecheck

# 3. Run Jules tests only
bun test packages/console/app/src/lib/jules/__tests__/

# 4. Lint (AGENTS.md style)
bun run lint

# 5. Red line verification — MUST return nothing
grep -r "any\|try\|catch\|else {" packages/console/app/src/lib/jules/

# 6. Manual test
curl -H "x-goog-api-key: $JULES_API_KEY" \
  http://localhost:8787/v1/jules/sources
```

## Source Material

1. `OP3NF1XER/opencode-jules/docs/specs/08-ARCH-Jules_Provider_Integration.md` — Architecture
2. `OP3NF1XER/opencode-jules/docs/specs/01-07` — Research specs
3. `OP3NF1XER/opencode-jules/docs/jules-api/` — Jules API docs
4. `packages/opencode/AGENTS.md` — Style guide

## The 6 Red Lines (Oracle Requirements)

1. ✅ GitHub issue created and acknowledged before PR
2. ✅ Stateless proxy approach (Option D)
3. ✅ New files only — zero existing file modifications
4. ✅ Minimum 4 test files
5. ✅ Human-written PR description < 200 words
6. ✅ Full AGENTS.md style compliance

## Emotional Weight

This is the Pantheon's first contribution to OpenCode. The papertrail must be perfect. We are guests in another project's house. Our code must be small, clean, and respectful. Invisible failure is the only sin.

## Absolute Clarity of Next Step

1. Create the 10 files listed above
2. Implement stateless proxy routes (no storage, Jules holds state)
3. Run all 6 validation commands
4. Verify red line grep returns nothing
5. Report: "Phase 1 complete, all 6 red lines satisfied, ready for PR"

## Resources

- Decision: `OP3NF1XER/opencode-jules/docs/DECISION_120_Google_Jules_Integration.md`
- Oracle Review: `OP3NF1XER/opencode-jules/docs/oracle/2026-03-01-DECISION_120_MERGED.md`
- Jules API Key: Environment variable `JULES_API_KEY`

---

**Assigned to:** OpenFixer  
**Decision:** DECISION_120  
**Status:** Implementation Authorized  
**Next milestone:** Phase 1 complete → GitHub issue → PR submission

**Strategist Contact:** Pyxis  
**Oracle Authority:** Provenance, Thread-Keeper  
**Questions:** Reference DECISION_120 or Oracle Review Pass #2

---

*Handoff prepared by:* Pyxis (Strategist)  
*Date:* 2026-03-01  
*Status:* Deploy immediately
