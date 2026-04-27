---
name: finish-work
description: "Pre-commit quality checklist covering lint, typecheck, tests, code-spec sync, API changes, database migrations, cross-layer verification, and manual testing. Blocks commit if infra or cross-layer specs lack executable depth. Use when code is written and tested but not yet committed, before submitting changes, or as a final review before git commit."
---

# Finish Work - Pre-Commit Checklist

Before submitting or committing, use this checklist to ensure work completeness.

**Timing**: After code is written and tested, before commit

---

## Checklist

### 1. Code Quality

```bash
# Must pass
pnpm lint
pnpm type-check
pnpm test
```

- [ ] `pnpm lint` passes with 0 errors?
- [ ] `pnpm type-check` passes with no type errors?
- [ ] Tests pass?
- [ ] No `console.log` statements (use logger)?
- [ ] No non-null assertions (the `x!` operator)?
- [ ] No `any` types?

### 2. Code-Spec Sync

**Code-Spec Docs**:
- [ ] Does `.trellis/spec/backend/` need updates?
  - New patterns, new modules, new conventions
- [ ] Does `.trellis/spec/frontend/` need updates?
  - New components, new hooks, new patterns
- [ ] Does `.trellis/spec/guides/` need updates?
  - New cross-layer flows, lessons from bugs

**Key Question**: 
> "If I fixed a bug or discovered something non-obvious, should I document it so future me (or others) won't hit the same issue?"

If YES -> Update the relevant code-spec doc.

### 2.5. Code-Spec Hard Block (Infra/Cross-Layer)

If this change touches infra or cross-layer contracts, this is a blocking checklist:

- [ ] Spec content is executable (real signatures/contracts), not principle-only text
- [ ] Includes file path + command/API name + payload field names
- [ ] Includes validation and error matrix
- [ ] Includes Good/Base/Bad cases
- [ ] Includes required tests and assertion points

**Block Rule**:
If infra/cross-layer changed but the related spec is still abstract, do NOT finish. Run `$update-spec` manually first.

### 3. API Changes

If you modified API endpoints:

- [ ] Input schema updated?
- [ ] Output schema updated?
- [ ] API documentation updated?
- [ ] Client code updated to match?

### 4. Database Changes

If you modified database schema:

- [ ] Migration file created?
- [ ] Schema file updated?
- [ ] Related queries updated?
- [ ] Seed data updated (if applicable)?

### 5. Cross-Layer Verification

If the change spans multiple layers:

- [ ] Data flows correctly through all layers?
- [ ] Error handling works at each boundary?
- [ ] Types are consistent across layers?
- [ ] Loading states handled?

### 6. Manual Testing

- [ ] Feature works in browser/app?
- [ ] Edge cases tested?
- [ ] Error states tested?
- [ ] Works after page refresh?

---

## Quick Check Flow

```bash
# 1. Code checks
pnpm lint && pnpm type-check

# 2. View changes
git status
git diff --name-only

# 3. Based on changed files, check relevant items above
```

---

## Common Oversights

| Oversight | Consequence | Check |
|-----------|-------------|-------|
| Code-spec docs not updated | Others don't know the change | Check .trellis/spec/ |
| Spec text is abstract only | Easy regressions in infra/cross-layer changes | Require signature/contract/matrix/cases/tests |
| Migration not created | Schema out of sync | Check db/migrations/ |
| Types not synced | Runtime errors | Check shared types |
| Tests not updated | False confidence | Run full test suite |
| Console.log left in | Noisy production logs | Search for console.log |

---

## Relationship to Other Commands

```
Development Flow:
  Write code -> Test -> $finish-work -> git commit -> $record-session
                          |                              |
                   Ensure completeness              Record progress
                   
Debug Flow:
  Hit bug -> Fix -> $break-loop -> Knowledge capture
                       |
                  Deep analysis
```

- `$finish-work` - Check work completeness (this skill)
- `$record-session` - Record session and commits
- `$break-loop` - Deep analysis after debugging

---

## Core Principle

> **Delivery includes not just code, but also documentation, verification, and knowledge capture.**

Complete work = Code + Docs + Tests + Verification
