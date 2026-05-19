<!-- Context: core/splitting-tasks | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Splitting Features into Tasks

**Purpose**: How to decompose features into atomic subtasks

**Last Updated**: 2026-01-11

---

## Prerequisites

- Feature request understood
- Context bundle loaded (project standards, patterns)

---

## Steps

### 1. Identify Atomic Boundaries

Break feature into tasks that are:
- Completable in 1-2 hours
- Have single, clear outcome
- Testable independently
- Don't overlap with other tasks

**Bad**: "Implement authentication" (too big)
**Good**: "Create password hashing utility" (atomic)

---

### 2. Map Dependencies

For each task, ask:
- What must exist before this can start?
- What files/APIs does this need?

```
01 → no deps (can start immediately)
02 → depends_on: ["01"]
03 → depends_on: ["01", "02"]
```

---

### 3. Identify Parallel Tasks

Mark `parallel: true` when:
- Task doesn't modify shared files
- Task doesn't depend on runtime state from other tasks
- Multiple agents could work simultaneously

Example parallel tasks:
- Writing independent unit tests
- Creating isolated utility functions
- Documentation for separate features

---

### 4. Define Acceptance Criteria

Binary pass/fail conditions only:
- "JWT tokens signed with RS256" ✓
- "Tests pass" ✓
- "Code is clean" ✗ (subjective)

---

### 5. Specify Deliverables

Concrete files/endpoints:
- `src/auth/hash.ts`
- `POST /api/login`
- `tests/auth.test.ts`

---

### 6. Reference Context Files

Don't embed descriptions. Reference paths:
```json
"context_files": [
  "(example: /Users/apple/.config/opencode/context/development/backend/auth/jwt-patterns.md)"
]
```

---

## Verification Checklist

- [ ] Each task completable in 1-2 hours?
- [ ] Dependencies create valid execution order?
- [ ] Parallel tasks correctly identified?
- [ ] Acceptance criteria are binary?
- [ ] Deliverables are concrete files/endpoints?

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Task too big | Split into 2-3 smaller tasks |
| Circular deps | Re-order or merge tasks |
| Missing deps | Run `task-cli.ts validate` |
| Vague criteria | Make binary pass/fail |

---

## Related

- `../standards/task-schema.md` - JSON field reference
- `managing-tasks.md` - Lifecycle workflow
- `../lookup/task-commands.md` - CLI reference
