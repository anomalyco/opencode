<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Testing an Agent

**Prerequisites**: Load `core-concepts/evals.md` first  
**Purpose**: Step-by-step workflow for testing agents

---

## Quick Start

```bash
# Run smoke test
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent} --pattern="smoke-test.yaml"

# Run all tests for agent
npm run eval:sdk -- --agent={category}/{agent}

# Run with debug
npm run eval:sdk -- --agent={category}/{agent} --debug
```

---

## Test Types

### 1. Smoke Test
**Purpose**: Basic functionality check

```yaml
name: Smoke Test
description: Verify agent responds correctly
agent: {category}/{agent}
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Hello, can you help me?"
expectations:
  - type: no_violations
```

**Run**:
```bash
npm run eval:sdk -- --agent={agent} --pattern="smoke-test.yaml"
```

---

### 2. Approval Gate Test
**Purpose**: Verify agent requests approval

```yaml
name: Approval Gate Test
description: Verify agent requests approval before execution
agent: {category}/{agent}
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Create a new file called test.js"
expectations:
  - type: specific_evaluator
    evaluator: approval_gate
    should_pass: true
```

---

### 3. Context Loading Test
**Purpose**: Verify agent loads required context

```yaml
name: Context Loading Test
description: Verify agent loads required context
agent: {category}/{agent}
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Write a new function"
expectations:
  - type: context_loaded
    contexts: ["core/standards/code-quality.md"]
```

---

### 4. Tool Usage Test
**Purpose**: Verify agent uses correct tools

```yaml
name: Tool Usage Test
description: Verify agent uses appropriate tools
agent: {category}/{agent}
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Read the package.json file"
expectations:
  - type: tool_usage
    tools: ["read"]
    min_count: 1
```

---

## Running Tests

### Single Test

```bash
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent} --pattern="{test-name}.yaml"
```

### All Tests for Agent

```bash
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent}
```

### All Tests (All Agents)

```bash
cd evals/framework
npm run eval:sdk
```

### With Debug Output

```bash
cd evals/framework
npm run eval:sdk -- --agent={agent} --pattern="{test}" --debug
```

---

## Interpreting Results

### Pass Example

```
✓ Test: smoke-test.yaml
  Status: PASS
  Duration: 5.2s
  
  Evaluators:
    ✓ Approval Gate: PASS
    ✓ Context Loading: PASS
    ✓ Tool Usage: PASS
    ✓ Stop on Failure: PASS
    ✓ Execution Balance: PASS
```

### Fail Example

```
✗ Test: approval-gate.yaml
  Status: FAIL
  Duration: 4.8s
  
  Evaluators:
    ✗ Approval Gate: FAIL
      Violation: Agent executed write tool without requesting approval
      Location: Message #3, Tool call #1
    ✓ Context Loading: PASS
    ✓ Tool Usage: PASS
```

---

## Debugging Failures

### Step 1: Run with Debug

```bash
npm run eval:sdk -- --agent={agent} --pattern="{test}" --debug
```

### Step 2: Check Session

```bash
# Find recent session
ls -lt .tmp/sessions/ | head -5

# View session
cat .tmp/sessions/{session-id}/session.json | jq
```

### Step 3: Analyze Events

```bash
# View event timeline
cat .tmp/sessions/{session-id}/events.json | jq
```

### Step 4: Identify Issue

Common issues:
- **Approval Gate Violation**: Agent executed without approval
- **Context Loading Violation**: Agent didn't load required context
- **Tool Usage Violation**: Agent used wrong tool (bash instead of read)
- **Stop on Failure Violation**: Agent auto-fixed instead of stopping

### Step 5: Fix Agent

Update agent prompt to address the issue, then re-test.

---

## Writing New Tests

### Test Template

```yaml
name: Test Name
description: What this test validates
agent: {category}/{agent}
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "User message"
  - role: assistant
    content: "Expected response (optional)"
expectations:
  - type: no_violations
```

### Best Practices

✅ **Clear name** - Descriptive test name  
✅ **Good description** - Explain what's being tested  
✅ **Realistic scenario** - Test real-world usage  
✅ **Specific expectations** - Clear pass/fail criteria  
✅ **Fast execution** - Keep under 10 seconds  

---

## Common Test Patterns

### Test Approval Workflow

```yaml
conversation:
  - role: user
    content: "Create a new file"
expectations:
  - type: specific_evaluator
    evaluator: approval_gate
    should_pass: true
```

### Test Context Loading

```yaml
conversation:
  - role: user
    content: "Write new code"
expectations:
  - type: context_loaded
    contexts: ["core/standards/code-quality.md"]
```

### Test Tool Selection

```yaml
conversation:
  - role: user
    content: "Read the README file"
expectations:
  - type: tool_usage
    tools: ["read"]
    min_count: 1
```

---

## Continuous Testing

### Pre-Commit Hook

```bash
# Setup pre-commit hook
./scripts/validation/setup-pre-commit-hook.sh
```

### CI/CD Integration

Tests run automatically on:
- Pull requests
- Merges to main
- Release tags

---

## Related Files

- **Eval concepts**: `core-concepts/evals.md`
- **Debugging guide**: `guides/debugging.md`
- **Adding agents**: `guides/adding-agent.md`

---

**Last Updated**: 2025-12-10  
**Version**: 0.5.0
