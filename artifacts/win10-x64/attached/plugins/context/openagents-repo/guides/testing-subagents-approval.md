<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

---
description: "Guide for testing subagents and handling approval gates"
type: "context"
category: "openagents-repo"
tags: [testing, subagents, approval-gates]
---

# Testing Subagents: Approval Gates

**Context**: openagents-repo/guides | **Priority**: HIGH | **Updated**: 2026-01-09

---

## Critical Rule: Subagents Don't Need Approval Gates

**IMPORTANT**: When writing tests for subagents, DO NOT include `expectedViolations` for `approval-gate`.

### Why?

Subagents are **delegated to** by parent agents (OpenAgent, OpenCoder, etc.). The parent agent already requested and received approval before delegating. Therefore:

- ✅ Subagents can execute tools directly without asking for approval
- ✅ Subagents inherit approval from their parent
- ❌ Subagents should NOT be tested for approval gate violations

### Test Configuration for Subagents

**Correct** (no approval gate expectations):
```yaml
category: developer
agent: ContextScout

approvalStrategy:
  type: auto-approve

behavior:
  mustUseTools:
    - read
    - glob
  forbiddenTools:
    - write
    - edit
  minToolCalls: 2
  maxToolCalls: 15

# NO expectedViolations for approval-gate!
```

**Incorrect** (don't do this):
```yaml
expectedViolations:
  - rule: approval-gate        # ❌ WRONG for subagents
    shouldViolate: false
    severity: error
```

---

## When to Test Approval Gates

**Test approval gates for**:
- ✅ Primary agents (OpenAgent, OpenCoder, System Builder)
- ✅ Category agents (frontend-specialist, data-analyst, etc.)

**Don't test approval gates for**:
- ❌ Subagents (contextscout, tester, reviewer, coder-agent, etc.)
- ❌ Any agent with `mode: subagent` in frontmatter

---

## Approval Strategy for Subagents

Always use `auto-approve` for subagent tests:

```yaml
approvalStrategy:
  type: auto-approve
```

This simulates the parent agent having already approved the delegation.

---

## Example: ContextScout Test

```yaml
id: contextscout-code-standards
name: "ContextScout: Code Standards Discovery"
description: Tests that ContextScout discovers code-related context files

category: developer
agent: ContextScout

prompts:
  - text: |
      Search for context files related to: coding standards
      
      Task type: code
      
      Return:
      - Exact file paths
      - Priority order
      - Key findings

approvalStrategy:
  type: auto-approve

behavior:
  mustUseTools:
    - read
    - glob
  forbiddenTools:
    - write
    - edit
  minToolCalls: 2
  maxToolCalls: 15

timeout: 60000

tags:
  - contextscout
  - discovery
  - subagent
```

---

## Related Files

- **Testing subagents**: `/Users/apple/.config/opencode/context/openagents-repo/guides/testing-subagents.md`
- **Subagent invocation**: `/Users/apple/.config/opencode/context/openagents-repo/guides/subagent-invocation.md`
- **Agent concepts**: `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/agents.md`

---

**Last Updated**: 2026-01-09  
**Version**: 1.0.0
