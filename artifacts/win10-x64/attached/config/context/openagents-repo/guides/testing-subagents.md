<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Testing Subagents - Step-by-Step Guide

**Purpose**: How to test subagents in standalone mode

**Last Updated**: 2026-01-09

---

## ⚠️ CRITICAL: Adding New Subagent to Framework

**Before testing**, you MUST update THREE locations in framework code:

### 1. `evals/framework/src/sdk/run-sdk-tests.ts` (~line 336)
Add to `subagentParentMap`:
```typescript
'contextscout': 'openagent',  // Maps subagent → parent
```

### 2. `evals/framework/src/sdk/run-sdk-tests.ts` (~line 414)
Add to `subagentPathMap`:
```typescript
'contextscout': 'ContextScout',  // Maps name → path
```

### 3. `evals/framework/src/sdk/test-runner.ts` (~line 238)
Add to `agentMap`:
```typescript
'contextscout': 'ContextScout.md',  // Maps name → file
```

**If missing from ANY map**: Tests will fail with "No test files found" or "Unknown subagent"

---

## Quick Start

```bash
# Test subagent directly (standalone mode)
cd evals/framework
npm run eval:sdk -- --subagent=contextscout --pattern="01-test.yaml"

# Test via delegation (integration mode)
npm run eval:sdk -- --subagent=contextscout --delegate --pattern="01-test.yaml"

# Debug mode
npm run eval:sdk -- --subagent=contextscout --pattern="01-test.yaml" --debug
```

---

## Step 1: Verify Agent File

**Check agent exists and has correct structure**:

```bash
# Check agent file
cat .opencode/agent/subagents/core/contextscout.md | head -20

# Verify frontmatter
grep -A 5 "^id:" .opencode/agent/subagents/core/contextscout.md
```

**Expected**:
```yaml
id: contextscout
name: ContextScout
category: subagents/core
type: subagent
mode: subagent  # ← Will be forced to 'primary' in standalone tests
```

---

## Step 2: Verify Test Configuration

**Check test config points to correct agent**:

```bash
cat evals/agents/ContextScout/config/config.yaml
```

**Expected**:
```yaml
agent: ContextScout  # ← Full path
model: anthropic/claude-sonnet-4-5
timeout: 60000
```

---

## Step 3: Run Standalone Test

**Use `--subagent` flag** (not `--agent`):

```bash
cd evals/framework
npm run eval:sdk -- --subagent=ContextScout --pattern="standalone/01-simple-discovery.yaml"
```

**What to Look For**:
```
⚡ Standalone Test Mode
   Subagent: contextscout
   Mode: Forced to 'primary' for direct testing
   
Testing agent: contextscout  # ← Should show subagent name
```

---

## Step 4: Verify Agent Loaded Correctly

**Check test results**:

```bash
# View latest results
cat evals/results/latest.json | jq '.meta'
```

**Expected**:
```json
{
  "agent": "ContextScout",  // ← Correct agent
  "model": "opencode/grok-code-fast",
  "timestamp": "2026-01-07T..."
}
```

**Red Flags**:
- `"agent": "core/openagent"` ← Wrong! OpenAgent is running instead
- `"agent": "contextscout"` ← Missing category prefix

---

## Step 5: Check Tool Usage

**Verify subagent used tools**:

```bash
# Check tool calls in output
cat evals/results/latest.json | jq '.tests[0]' | grep -A 5 "Tool Calls"
```

**Expected** (for ContextScout):
```
Tool Calls: 1
Tools Used: glob

Tool Call Details:
  1. glob: {"pattern":"*.md","path":"/Users/apple/.config/opencode/context/core"}
```

**Red Flags**:
- `Tool Calls: 0` ← Agent didn't use any tools
- `Tools Used: task` ← Parent agent delegating (wrong mode)

---

## Step 6: Analyze Failures

**If test fails, check violations**:

```bash
cat evals/results/latest.json | jq '.tests[0].violations'
```

**Common Issues**:

### Issue 1: No Tool Calls
```json
{
  "type": "missing-required-tool",
  "message": "Required tool 'glob' was not used"
}
```

**Cause**: Agent prompt doesn't emphasize tool usage  
**Fix**: Add critical rules section emphasizing tools (see `examples/subagent-prompt-structure.md`)

### Issue 2: Wrong Agent Running
```
Agent: OpenAgent
```

**Cause**: Used `--agent` instead of `--subagent`  
**Fix**: Use `--subagent=ContextScout`

### Issue 3: Tool Permission Denied
```json
{
  "type": "missing-approval",
  "message": "Execution tool 'bash' called without requesting approval"
}
```

**Cause**: Agent tried to use restricted tool  
**Fix**: See `errors/tool-permission-errors.md`

---

## Step 7: Validate Results

**Check test passed**:

```bash
# View summary
cat evals/results/latest.json | jq '.summary'
```

**Expected**:
```json
{
  "total": 1,
  "passed": 1,  // ← Should be 1
  "failed": 0,
  "pass_rate": 1.0
}
```

---

## Test File Organization

**Best Practice**: Organize by mode

```
evals/agents/ContextScout/tests/
├── standalone/           # Unit tests (--subagent flag)
│   ├── 01-simple-discovery.yaml
│   ├── 02-search-test.yaml
│   └── 03-extraction-test.yaml
└── delegation/           # Integration tests (--agent flag)
    ├── 01-openagent-delegates.yaml
    └── 02-context-loading.yaml
```

---

## Writing Good Test Prompts

**Be explicit about tool usage**:

❌ **Vague** (may not work):
```yaml
prompts:
  - text: |
      List all markdown files in /Users/apple/.config/opencode/context/core/
```

✅ **Explicit** (works):
```yaml
prompts:
  - text: |
      Use the glob tool to find all markdown files in /Users/apple/.config/opencode/context/core/
      
      You MUST use the glob tool like this:
      glob(pattern="*.md", path="/Users/apple/.config/opencode/context/core")
      
      Then list the files you found.
```

---

## Quick Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| OpenAgent runs instead | Used `--agent` flag | Use `--subagent` flag |
| Tool calls: 0 | Prompt doesn't emphasize tools | Add critical rules section |
| Permission denied | Tool restricted in frontmatter | Check `tools:` and `permissions:` |
| Test timeout | Agent stuck/looping | Check prompt logic, add timeout |

---

## Related

- `concepts/subagent-testing-modes.md` - Understand standalone vs delegation
- `lookup/subagent-test-commands.md` - Quick command reference
- `errors/tool-permission-errors.md` - Common permission issues
- `examples/subagent-prompt-structure.md` - Optimized prompt structure

**Reference**: `evals/framework/src/sdk/run-sdk-tests.ts`
