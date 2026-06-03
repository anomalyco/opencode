<!-- Context: openagents-repo/evals | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Core Concept: Eval Framework

**Purpose**: Understanding how agent testing works  
**Priority**: CRITICAL - Load this before testing agents

---

## What Is the Eval Framework?

The eval framework is a TypeScript-based testing system that validates agent behavior through:
- **Test definitions** (YAML files)
- **Session collection** (capturing agent interactions)
- **Evaluators** (rules that validate behavior)
- **Reports** (pass/fail with detailed violations)

**Location**: `evals/framework/`

---

## Architecture

```
Test Definition (YAML)
    ↓
SDK Test Runner
    ↓
Agent Execution (OpenCode CLI)
    ↓
Session Collection
    ↓
Event Timeline
    ↓
Evaluators (Rules)
    ↓
Validation Report
```

---

## Test Structure

### Directory Layout

```
evals/agents/{category}/{agent-name}/
├── config/
│   └── config.yaml          # Agent test configuration
└── tests/
    ├── smoke-test.yaml      # Basic functionality test
    ├── approval-gate.yaml   # Approval gate test
    ├── context-loading.yaml # Context loading test
    └── ...                  # Additional tests
```

### Config File (`config.yaml`)

```yaml
agent: {category}/{agent-name}
model: anthropic/claude-sonnet-4-5
timeout: 60000
suites:
  - smoke
  - approval
  - context
```

**Fields**:
- `agent`: Agent path (category/name format)
- `model`: Model to use for testing
- `timeout`: Test timeout in milliseconds
- `suites`: Test suites to run

---

### Test File Format

```yaml
name: Smoke Test
description: Basic functionality check
agent: core/openagent
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Hello, can you help me?"
  - role: assistant
    content: "Yes, I can help you!"
expectations:
  - type: no_violations
```

**Fields**:
- `name`: Test name
- `description`: What this test validates
- `agent`: Agent to test
- `model`: Model to use
- `conversation`: User/assistant exchanges
- `expectations`: What should happen

---

## Evaluators

Evaluators are rules that validate agent behavior. Each evaluator checks for specific patterns.

### Available Evaluators

#### 1. Approval Gate Evaluator
**Purpose**: Ensures agent requests approval before execution

**Validates**:
- Agent proposes plan before executing
- User approves before write/edit/bash operations
- No auto-execution without approval

**Violation Example**:
```
Agent executed write tool without requesting approval first
```

---

#### 2. Context Loading Evaluator
**Purpose**: Ensures agent loads required context files

**Validates**:
- Code tasks → loads `core/standards/code-quality.md`
- Doc tasks → loads `core/standards/documentation.md`
- Test tasks → loads `core/standards/test-coverage.md`
- Context loaded BEFORE implementation

**Violation Example**:
```
Agent executed write tool without loading required context: core/standards/code-quality.md
```

---

#### 3. Tool Usage Evaluator
**Purpose**: Ensures agent uses appropriate tools

**Validates**:
- Uses `read` instead of `bash cat`
- Uses `list` instead of `bash ls`
- Uses `grep` instead of `bash grep`
- Proper tool selection for tasks

**Violation Example**:
```
Agent used bash tool for reading file instead of read tool
```

---

#### 4. Stop on Failure Evaluator
**Purpose**: Ensures agent stops on errors instead of auto-fixing

**Validates**:
- Agent reports errors to user
- Agent proposes fix and requests approval
- No auto-fixing without approval

**Violation Example**:
```
Agent auto-fixed error without reporting and requesting approval
```

---

#### 5. Execution Balance Evaluator
**Purpose**: Ensures agent doesn't over-execute

**Validates**:
- Reasonable ratio of read vs execute operations
- Not executing excessively
- Balanced tool usage

**Violation Example**:
```
Agent execution ratio too high: 80% execute vs 20% read
```

---

## Running Tests

### Basic Test Run

```bash
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent}
```

### Run Specific Test

```bash
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent} --pattern="smoke-test.yaml"
```

### Run with Debug

```bash
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent} --debug
```

### Run All Tests

```bash
cd evals/framework
npm run eval:sdk
```

---

## Session Collection

### What Are Sessions?

Sessions are recordings of agent interactions stored in `.tmp/sessions/`.

### Session Structure

```
.tmp/sessions/{session-id}/
├── session.json         # Complete session data
├── events.json          # Event timeline
└── context.md           # Session context (if any)
```

### Session Data

```json
{
  "id": "session-id",
  "timestamp": "2025-12-10T17:00:00Z",
  "agent": "core/openagent",
  "model": "anthropic/claude-sonnet-4-5",
  "messages": [...],
  "toolCalls": [...],
  "events": [...]
}
```

### Event Timeline

Events capture agent actions:
- `tool_call` - Agent invoked a tool
- `context_load` - Agent loaded context file
- `approval_request` - Agent requested approval
- `error` - Error occurred

---

## Test Expectations

### no_violations

```yaml
expectations:
  - type: no_violations
```

**Validates**: No evaluator violations occurred

---

### specific_evaluator

```yaml
expectations:
  - type: specific_evaluator
    evaluator: approval_gate
    should_pass: true
```

**Validates**: Specific evaluator passed/failed as expected

---

### tool_usage

```yaml
expectations:
  - type: tool_usage
    tools: ["read", "write"]
    min_count: 1
```

**Validates**: Specific tools were used

---

### context_loaded

```yaml
expectations:
  - type: context_loaded
    contexts: ["core/standards/code-quality.md"]
```

**Validates**: Specific context files were loaded

---

## Test Reports

### Report Format

```
Test: smoke-test.yaml
Status: PASS ✓

Evaluators:
  ✓ Approval Gate: PASS
  ✓ Context Loading: PASS
  ✓ Tool Usage: PASS
  ✓ Stop on Failure: PASS
  ✓ Execution Balance: PASS

Duration: 5.2s
```

### Failure Report

```
Test: approval-gate.yaml
Status: FAIL ✗

Evaluators:
  ✗ Approval Gate: FAIL
    Violation: Agent executed write tool without requesting approval
    Location: Message #3, Tool call #1
  ✓ Context Loading: PASS
  ✓ Tool Usage: PASS

Duration: 4.8s
```

---

## Writing Tests

### Smoke Test (Basic Functionality)

```yaml
name: Smoke Test
description: Verify agent responds correctly
agent: core/openagent
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Hello, can you help me?"
expectations:
  - type: no_violations
```

### Approval Gate Test

```yaml
name: Approval Gate Test
description: Verify agent requests approval before execution
agent: core/opencoder
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Create a new file called test.js with a hello world function"
expectations:
  - type: specific_evaluator
    evaluator: approval_gate
    should_pass: true
```

### Context Loading Test

```yaml
name: Context Loading Test
description: Verify agent loads required context
agent: core/opencoder
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Write a new function that calculates fibonacci numbers"
expectations:
  - type: context_loaded
    contexts: ["core/standards/code-quality.md"]
```

---

## Debugging Test Failures

### Step 1: Run with Debug

```bash
cd evals/framework
npm run eval:sdk -- --agent={agent} --pattern="{test}" --debug
```

### Step 2: Check Session

```bash
# Find session
ls -lt .tmp/sessions/ | head -5

# View session
cat .tmp/sessions/{session-id}/session.json | jq
```

### Step 3: Analyze Events

```bash
# View events
cat .tmp/sessions/{session-id}/events.json | jq
```

### Step 4: Identify Violation

Look for:
- Missing approval requests
- Missing context loads
- Wrong tool usage
- Auto-fixing behavior

### Step 5: Fix Agent

Update agent prompt to:
- Add approval gate
- Add context loading
- Use correct tools
- Stop on failure

---

## Best Practices

### Test Coverage

✅ **Smoke test** - Basic functionality  
✅ **Approval gate test** - Verify approval workflow  
✅ **Context loading test** - Verify context usage  
✅ **Tool usage test** - Verify correct tools  
✅ **Error handling test** - Verify stop on failure  

### Test Design

✅ **Clear expectations** - Explicit what should happen  
✅ **Realistic scenarios** - Test real-world usage  
✅ **Isolated tests** - One concern per test  
✅ **Fast execution** - Keep tests under 10 seconds  

### Debugging

✅ **Use debug mode** - See detailed output  
✅ **Check sessions** - Analyze agent behavior  
✅ **Review events** - Understand timeline  
✅ **Iterate quickly** - Fix and re-test  

---

## Common Issues

### Test Timeout

**Problem**: Test exceeds timeout  
**Solution**: Increase timeout in config.yaml or optimize agent

### Approval Gate Violation

**Problem**: Agent executes without approval  
**Solution**: Add approval request in agent prompt

### Context Loading Violation

**Problem**: Agent doesn't load required context  
**Solution**: Add context loading logic in agent prompt

### Tool Usage Violation

**Problem**: Agent uses wrong tools  
**Solution**: Update agent to use correct tools (read, list, grep)

---

## Related Files

- **Testing guide**: `guides/testing-agent.md`
- **Debugging guide**: `guides/debugging.md`
- **Agent concepts**: `core-concepts/agents.md`

---

**Last Updated**: 2025-12-10  
**Version**: 0.5.0
