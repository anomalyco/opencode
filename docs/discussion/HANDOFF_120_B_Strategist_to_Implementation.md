---
handoff_id: HANDOFF_120_B
from: Pyxis (Strategist)
to: OpenFixer / WindFixer (Implementation)
date: 2026-03-01
decision: DECISION_120
---

# Handoff: DECISION_120 Jules Integration - Implementation Execution

## Status

| Item | Status |
|------|--------|
| Decision status | ✅ **Approved** (CONDITIONAL - 52/100) |
| Oracle assessment | ✅ Complete (6 red lines identified) |
| Designer architecture | ✅ Complete (stateless proxy pattern) |
| GitHub issue alignment | ✅ Identified (#6627, #9649) |
| Implementation ready | ✅ Ready for execution |

---

## GitHub Issue Alignment (CRITICAL)

**This implementation addresses community feature requests:**

### Primary: Issue #6627 - "Delegate to Coding Agent?"
- **Opened:** Jan 2, 2026 by @adrians5j
- **Request:** IntelliJ Copilot-style coding agent delegation
- **Our Solution:** Google Jules integration - session-based coding agent with GitHub repo access
- **PR Strategy:** Reference #6627 in PR description

### Secondary: Issue #9649 - "Multi-Agent Coding"
- **Opened:** Jan 20, 2026 by @LordRelentless  
- **Request:** Multi-agent collaboration mode
- **Our Solution:** Jules as external coding specialist agent
- **PR Strategy:** Mention as related capability

**Philosophical Alignment:**
- ✅ Small, focused PR (10 new files, 0 modifications)
- ✅ Stateless design respects Cloudflare Workers
- ✅ No new infrastructure dependencies
- ✅ AGENTS.md style compliance
- ✅ Test coverage demonstrates quality

---

## The 6 Red Lines (Oracle Requirements)

🔴 **These MUST be satisfied for CLEAR status:**

1. ✅ **GitHub issue created and acknowledged before PR**
   - Create new issue referencing #6627
   - Wait for maintainer acknowledgment
   - Link PR to issue

2. ✅ **Stateless proxy approach (Option D)**
   - Jules API holds all state
   - Server is authenticated pass-through only
   - No storage, no sessions, no persistence

3. ✅ **New files only — zero existing file modifications**
   - 10 files in `packages/console/app/src/lib/jules/`
   - 0 modifications to existing code
   - grep verification required before submission

4. ✅ **Minimum 4 test files**
   - `client.test.ts` - HTTP client tests
   - `schemas.test.ts` - Zod validation tests
   - `config.test.ts` - Configuration tests
   - `routes.test.ts` - Route handler tests

5. ✅ **Human-written PR description < 200 words**
   - Reference issue #6627
   - Include curl-based manual test
   - No AI-generated prose

6. ✅ **Full AGENTS.md style compliance**
   - No `any` type
   - No `try`/`catch`
   - No `else` statements
   - Single-word variable names
   - Early returns only

---

## Target Repository Context

**Repository:** https://github.com/anomalyco/opencode
**Branch:** `dev` (not `main`)
**Deployment:** Cloudflare Workers via SST
**Style Authority:** `AGENTS.md` in repo root

**AGENTS.md Compliance Checklist:**
```
- [ ] No `any` type — use `unknown` + type guards
- [ ] No `try`/`catch` — use early returns + error types  
- [ ] No `else` statements — early return pattern
- [ ] No destructuring — dot notation: obj.a, obj.b
- [ ] Single word names: client, not julesClient
- [ ] `const` only — no `let`, use ternaries
- [ ] Bun APIs: Bun.file(), Bun.env
- [ ] Functional methods: flatMap, filter, map with type guards
```

---

## Implementation Contract

### File Structure (10 New Files)

```
packages/console/app/src/lib/jules/
├── index.ts                    # Public API exports (15 lines)
├── types.ts                    # Jules API types (80 lines)
├── config.ts                   # Configuration (30 lines)
├── client/
│   ├── JulesClient.ts          # HTTP/REST implementation (120 lines)
│   ├── schemas.ts              # Zod validation schemas (60 lines)
│   └── errors.ts               # Jules-specific errors (40 lines)
├── routes/
│   └── jules.ts                # Hono route handlers (100 lines)
└── __tests__/
    ├── client.test.ts          # HTTP client tests (80 lines)
    ├── schemas.test.ts         # Validation tests (60 lines)
    ├── config.test.ts          # Config tests (40 lines)
    └── routes.test.ts          # Route tests (80 lines)
```

**Total Lines:** ~685 lines
**Modified Files:** 0 (zero)

### Route Design (Stateless Proxy)

```typescript
// All routes proxy to jules.googleapis.com/v1alpha
POST /v1/jules/sessions              // Create session
GET  /v1/jules/sessions/:id          // Get session status
GET  /v1/jules/sessions/:id/activities  // List activities
POST /v1/jules/sessions/:id/approve     // Approve plan
POST /v1/jules/sessions/:id/message     // Send message
GET  /v1/jules/sources               // List sources
```

**Route Handler Pattern:**
1. Extract `x-goog-api-key` from request header (or env var)
2. Forward to `jules.googleapis.com/v1alpha`
3. Return raw Jules response (verbatim JSON preservation)
4. No transformation, no storage, no state

### Configuration (Environment Only)

```typescript
// config.ts — no files, no KV, no storage
interface JulesConfig {
  apiKey: string | null      // from JULES_API_KEY env var
  baseUrl: string            // https://jules.googleapis.com/v1alpha
  timeoutMs: number          // 30000
  maxRetries: number         // 3
}
```

### Error Handling (No try/catch)

```typescript
// errors.ts — use error types, not exceptions
class JulesError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

// Early return pattern
function handleResponse(response: Response): Result<Data, Error> {
  if (!response.ok) {
    return err(new JulesError(response.status, await response.text()))
  }
  return ok(await response.json())
}
```

---

## Source Material

**Required Reading:**
1. `c:\P4NTH30N\DE51GN3R\architectures\ARCHITECTURE_DECISION_120_Jules_Integration.md` (Designer spec)
2. `c:\P4NTH30N\OR4CL3\assessments\2026-03-01-DECISION_120.md` (Oracle risk assessment)
3. `c:\P4NTH30N\OP3NF1XER\opencode-jules\google-jules\*.md` (Jules API docs)
4. `c:\P4NTH30N\OP3NF1XER\opencode-jules\AGENTS.md` (Style guide - CRITICAL)

**Jules API Reference:**
- Base URL: `https://jules.googleapis.com/v1alpha`
- Authentication: `x-goog-api-key` header
- Resources: Sources, Sessions, Activities
- Session States: QUEUED → PLANNING → AWAITING_PLAN_APPROVAL → IN_PROGRESS → COMPLETED/FAILED

---

## Validation Commands

**Before Submission:**
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

---

## PR Submission Checklist

**Before Creating PR:**
- [ ] GitHub issue created referencing #6627
- [ ] Issue acknowledged by maintainer
- [ ] All 10 files implemented
- [ ] 4+ test files with passing tests
- [ ] Type check passes
- [ ] Lint passes
- [ ] Red line grep returns nothing
- [ ] Manual curl test succeeds

**PR Description Template (< 200 words):**
```markdown
Implements Google Jules integration, addressing #6627 (coding agent delegation).

This PR adds a stateless proxy to Google Jules API, enabling OpenCode to delegate
coding tasks to Google's AI agent. Jules provides session-based execution, GitHub
integration, and automatic PR creation.

**Changes:**
- 10 new files in `packages/console/app/src/lib/jules/`
- Stateless proxy design (no storage, Jules holds state)
- 4 test files with full coverage
- AGENTS.md compliant (no any, no try/catch, no else)

**Manual Test:**
```bash
export JULES_API_KEY="your-key"
curl -H "x-goog-api-key: $JULES_API_KEY" \
  http://localhost:8787/v1/jules/sources
```

Closes #6627
```

---

## First PR Significance

**This is the Pantheon's first contribution to OpenCode.**

The papertrail must be perfect. The implementation must be small, clean, and demonstrate respect for the target project's culture. We are guests in another project's house.

**Success Metrics:**
- ✅ PR merged without revision requests
- ✅ Maintainer acknowledges alignment with #6627
- ✅ No style violations in review
- ✅ Tests pass in CI

**Failure Modes:**
- ❌ Red line violations → instant rejection
- ❌ Missing tests → "add tests" request
- ❌ AI-generated PR description → "rewrite this" request
- ❌ Existing file modifications → "revert these" request

---

## Handoff Complete

**Assigned to:** OpenFixer / WindFixer  
**Decision:** DECISION_120  
**Status:** Ready for implementation  
**Next milestone:** 
1. Create GitHub issue referencing #6627
2. Implement 10 files per specification
3. Run validation commands
4. Submit PR with human-written description

**Strategist Contact:** Pyxis  
**Questions:** Reference DECISION_120 or HANDOFF_120_A/B

---

*Handoff prepared by:* Pyxis (Strategist)  
*Date:* 2026-03-01  
*Decision status:* Approved (CONDITIONAL - 6 red lines)  
*Target:* https://github.com/anomalyco/opencode
