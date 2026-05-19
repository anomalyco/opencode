<!-- Context: openagents-repo/concepts | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Subagent Testing Modes

**Purpose**: Understand the two ways to test subagents (standalone vs delegation)

**Last Updated**: 2026-01-07

---

## Core Concept

Subagents have **two distinct testing modes** depending on what you're validating:

1. **Standalone Mode** - Test subagent logic directly (unit testing)
2. **Delegation Mode** - Test parent → subagent workflow (integration testing)

The mode determines which agent runs and how tools are used.

---

## Standalone Mode (Unit Testing)

**Purpose**: Test subagent's logic in isolation

**Command**:
```bash
npm run eval:sdk -- --subagent=ContextScout
```

**What Happens**:
- Eval framework forces `mode: primary` (overrides `mode: subagent`)
- ContextScout runs as the primary agent
- ContextScout uses tools directly (glob, read, grep, list)
- No parent agent involved

**Use For**:
- Unit testing subagent logic
- Debugging tool usage
- Feature development
- Verifying prompt changes

**Test Location**: `evals/agents/subagents/core/{subagent}/tests/standalone/`

---

## Delegation Mode (Integration Testing)

**Purpose**: Test real production workflow (parent delegates to subagent)

**Command**:
```bash
npm run eval:sdk -- --agent=core/openagent --pattern="delegation/*.yaml"
```

**What Happens**:
- OpenAgent runs as primary agent
- OpenAgent uses `task` tool to delegate to ContextScout
- ContextScout runs with `mode: subagent` (natural mode)
- Tests full delegation workflow

**Use For**:
- Integration testing
- Validating production behavior
- Testing delegation logic
- End-to-end workflows

**Test Location**: `evals/agents/subagents/core/{subagent}/tests/delegation/`

---

## Critical Distinction

| Aspect | Standalone Mode | Delegation Mode |
|--------|----------------|-----------------|
| **Flag** | `--subagent=NAME` | `--agent=PARENT` |
| **Agent Mode** | Forced to `primary` | Natural `subagent` |
| **Who Runs** | Subagent directly | Parent → Subagent |
| **Tool Usage** | Subagent uses tools | Parent uses `task` tool |
| **Tests** | `standalone/*.yaml` | `delegation/*.yaml` |

**Common Mistake**:
```bash
# ❌ WRONG - This runs OpenAgent, not ContextScout
npm run eval:sdk -- --agent=ContextScout

# ✅ CORRECT - This runs ContextScout directly
npm run eval:sdk -- --subagent=ContextScout
```

---

## How to Verify Correct Mode

### Standalone Mode Indicators:
```
⚡ Standalone Test Mode
   Subagent: contextscout
   Mode: Forced to 'primary' for direct testing
```

### Delegation Mode Indicators:
```
Testing agent: core/openagent
🎯 PARENT: OpenAgent
   Delegating to: contextscout
```

---

## When to Use Each Mode

**Use Standalone When**:
- Testing subagent's core logic
- Debugging why subagent isn't using tools
- Validating prompt changes
- Quick iteration during development

**Use Delegation When**:
- Testing production workflow
- Validating parent → subagent communication
- Testing context passing
- Integration testing

---

## Related

- `guides/testing-subagents.md` - Step-by-step testing guide
- `lookup/subagent-test-commands.md` - Quick command reference
- `errors/tool-permission-errors.md` - Common testing issues

**Reference**: `evals/framework/src/sdk/run-sdk-tests.ts` (mode forcing logic)
