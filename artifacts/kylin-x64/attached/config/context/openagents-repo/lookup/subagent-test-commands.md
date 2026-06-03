<!-- Context: openagents-repo/lookup | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Subagent Testing Commands - Quick Reference

**Purpose**: Quick command reference for testing subagents

**Last Updated**: 2026-01-07

---

## Standalone Mode (Unit Testing)

### Run All Standalone Tests
```bash
cd evals/framework
npm run eval:sdk -- --subagent=ContextScout --pattern="standalone/*.yaml"
```

### Run Single Test
```bash
npm run eval:sdk -- --subagent=ContextScout --pattern="standalone/01-simple-discovery.yaml"
```

### Debug Mode
```bash
npm run eval:sdk -- --subagent=ContextScout --pattern="standalone/*.yaml" --debug
```

---

## Delegation Mode (Integration Testing)

### Run Delegation Tests
```bash
npm run eval:sdk -- --agent=core/openagent --pattern="delegation/*.yaml"
```

### Test Specific Delegation
```bash
npm run eval:sdk -- --agent=core/openagent --pattern="delegation/01-contextscout-delegation.yaml"
```

---

## Verification Commands

### Check Agent File
```bash
# View agent frontmatter
head -30 .opencode/agent/subagents/core/contextscout.md

# Check tool permissions
grep -A 10 "^tools:" .opencode/agent/subagents/core/contextscout.md
```

### Check Test Config
```bash
cat evals/agents/ContextScout/config/config.yaml
```

### View Latest Results
```bash
# Summary
cat evals/results/latest.json | jq '.summary'

# Agent loaded
cat evals/results/latest.json | jq '.meta.agent'

# Tool calls
cat evals/results/latest.json | jq '.tests[0]' | grep -A 5 "Tool"

# Violations
cat evals/results/latest.json | jq '.tests[0].violations'
```

---

## Common Test Patterns

### Smoke Test
```bash
npm run eval:sdk -- --subagent=ContextScout --pattern="smoke-test.yaml"
```

### Specific Test Suite
```bash
npm run eval:sdk -- --subagent=ContextScout --pattern="discovery/*.yaml"
```

### All Tests for Subagent
```bash
npm run eval:sdk -- --subagent=ContextScout
```

---

## Flag Reference

| Flag | Purpose | Example |
|------|---------|---------|
| `--subagent` | Test subagent in standalone mode | `--subagent=ContextScout` |
| `--agent` | Test primary agent (or delegation) | `--agent=core/openagent` |
| `--pattern` | Filter test files | `--pattern="standalone/*.yaml"` |
| `--debug` | Show detailed output | `--debug` |
| `--timeout` | Override timeout | `--timeout=120000` |

---

## Troubleshooting Commands

### Check Which Agent Ran
```bash
# Should show subagent name for standalone mode
cat evals/results/latest.json | jq '.meta.agent'
```

### Check Tool Usage
```bash
# Should show tool calls > 0
cat evals/results/latest.json | jq '.tests[0]' | grep "Tool Calls"
```

### View Test Timeline
```bash
# See full conversation
cat evals/results/history/2026-01/07-*.json | jq '.tests[0].timeline'
```

### Check for Errors
```bash
# View violations
cat evals/results/latest.json | jq '.tests[0].violations.details'
```

---

## File Locations

### Agent Files
```
.opencode/agent/subagents/core/{subagent}.md
```

### Test Files
```
evals/agents/subagents/core/{subagent}/
├── config/config.yaml
└── tests/
    ├── standalone/
    │   ├── 01-simple-discovery.yaml
    │   └── 02-advanced-test.yaml
    └── delegation/
        └── 01-delegation-test.yaml
```

### Results
```
evals/results/
├── latest.json                    # Latest test run
└── history/2026-01/              # Historical results
    └── 07-HHMMSS-{agent}.json
```

---

## Quick Checks

### Is Agent Loaded Correctly?
```bash
# Should show: "agent": "ContextScout"
cat evals/results/latest.json | jq '.meta.agent'
```

### Did Agent Use Tools?
```bash
# Should show: Tool Calls: 1 (or more)
cat evals/results/latest.json | jq '.tests[0]' | grep "Tool Calls"
```

### Did Test Pass?
```bash
# Should show: "passed": 1, "failed": 0
cat evals/results/latest.json | jq '.summary'
```

---

## Related

- `concepts/subagent-testing-modes.md` - Understand testing modes
- `guides/testing-subagents.md` - Step-by-step testing guide
- `errors/tool-permission-errors.md` - Fix common issues

**Reference**: `evals/framework/src/sdk/run-sdk-tests.ts`
