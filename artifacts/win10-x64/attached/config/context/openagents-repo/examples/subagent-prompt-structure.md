<!-- Context: openagents-repo/examples | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Subagent Prompt Structure (Optimized)

**Purpose**: Template for well-structured subagent prompts with tool usage emphasis

**Last Updated**: 2026-01-07

---

## Core Principle

**Position Sensitivity**: Critical instructions in first 15% of prompt improves adherence.

For subagents, the most critical instruction is: **which tools to use**.

---

## Optimized Structure

```xml
---
# Frontmatter (lines 1-50)
id: subagent-name
name: Subagent Name
category: subagents/core
type: subagent
mode: subagent
tools:
  read: true
  grep: true
  glob: true
  list: true
  bash: false
  edit: false
  write: false
permissions:
  bash: "*": "deny"
  edit: "**/*": "deny"
  write: "**/*": "deny"
---

# Agent Name

> **Mission**: One-sentence mission statement

Brief description (1-2 sentences).

---

<!-- CRITICAL: This section must be in first 15% -->
<critical_rules priority="absolute" enforcement="strict">
  <rule id="tool_usage">
    ONLY use: glob, read, grep, list
    NEVER use: bash, write, edit, task
    You're read-only—no modifications allowed
  </rule>
  <rule id="always_use_tools">
    ALWAYS use tools to discover/verify
    NEVER assume or fabricate information
  </rule>
  <rule id="output_format">
    ALWAYS include: exact paths, specific details, evidence
  </rule>
</critical_rules>

---

<context>
  <system>What system this agent operates in</system>
  <domain>What domain knowledge it needs</domain>
  <task>What it does</task>
  <constraints>What limits it has</constraints>
</context>

<role>One-sentence role description</role>

<task>One-sentence task description</task>

---

<execution_priority>
  <tier level="1" desc="Critical Operations">
    - @tool_usage: Use ONLY allowed tools
    - @always_use_tools: Verify everything
    - @output_format: Precise results
  </tier>
  <tier level="2" desc="Core Workflow">
    - Main workflow steps
  </tier>
  <tier level="3" desc="Quality">
    - Quality checks
    - Validation
  </tier>
  <conflict_resolution>
    Tier 1 always overrides Tier 2/3
  </conflict_resolution>
</execution_priority>

---

## Workflow

### Stage 1: Discovery
**Action**: Use tools to discover information
**Process**: 1. Use glob/list, 2. Use read, 3. Use grep
**Output**: Discovered items

### Stage 2: Analysis
**Action**: Analyze discovered information
**Process**: Extract key details
**Output**: Analyzed results

### Stage 3: Present
**Action**: Return structured response
**Process**: Format according to @output_format
**Output**: Complete response

---

## What NOT to Do

- ❌ **NEVER use bash/write/edit/task tools** (@tool_usage)
- ❌ Don't assume information—verify with tools
- ❌ Don't fabricate paths or details
- ❌ Don't skip required output fields

---

## Remember

**Your Tools**: glob (discover) | read (extract) | grep (search) | list (structure)

**Your Constraints**: Read-only, verify everything, precise output

**Your Value**: Accurate, verified information using tools
```

---

## Key Optimizations Applied

### 1. Critical Rules Early (Lines 50-80)

**Before** (buried at line 596):
```markdown
## Important Guidelines
...
(400 lines later)
### Tool Usage
- Use glob, read, grep, list
```

**After** (at line 50):
```xml
<critical_rules priority="absolute" enforcement="strict">
  <rule id="tool_usage">
    ONLY use: glob, read, grep, list
    NEVER use: bash, write, edit, task
  </rule>
</critical_rules>
```

**Impact**: 47.5% reduction in prompt length, tool usage emphasized early.

---

### 2. Execution Priority (3-Tier System)

```xml
<execution_priority>
  <tier level="1" desc="Critical">
    - Tool usage rules
    - Verification requirements
  </tier>
  <tier level="2" desc="Core">
    - Main workflow
  </tier>
  <tier level="3" desc="Quality">
    - Nice-to-haves
  </tier>
  <conflict_resolution>Tier 1 always overrides</conflict_resolution>
</execution_priority>
```

**Why**: Resolves conflicts, makes priorities explicit.

---

### 3. Flattened Nesting (≤4 Levels)

**Before** (6-7 levels):
```xml
<instructions>
  <workflow>
    <stage>
      <process>
        <step>
          <action>
            <detail>...</detail>
          </action>
        </step>
      </process>
    </stage>
  </workflow>
</instructions>
```

**After** (3-4 levels):
```xml
<workflow>
  <stage id="1" name="Discovery">
    <action>Use tools</action>
    <process>1. glob, 2. read, 3. grep</process>
  </stage>
</workflow>
```

**Why**: Improves clarity, reduces cognitive load.

---

### 4. Explicit "What NOT to Do"

```markdown
## What NOT to Do

- ❌ **NEVER use bash/write/edit/task tools**
- ❌ Don't assume—verify with tools
- ❌ Don't fabricate information
```

**Why**: Negative examples prevent common mistakes.

---

## File Size Targets

| Section | Target Lines | Purpose |
|---------|--------------|---------|
| Frontmatter | 30-50 | Agent metadata |
| Critical Rules | 20-30 | Tool usage, core rules |
| Context/Role/Task | 20-30 | Agent identity |
| Execution Priority | 20-30 | Priority system |
| Workflow | 80-120 | Main instructions |
| Guidelines | 40-60 | Best practices |
| **Total** | **<400 lines** | MVI compliant |

---

## Validation Checklist

Before deploying optimized prompt:

- [ ] Critical rules in first 15% (lines 50-80)?
- [ ] Tool usage explicitly stated?
- [ ] Nesting ≤4 levels?
- [ ] Execution priority defined?
- [ ] "What NOT to Do" section included?
- [ ] Total lines <400?
- [ ] Semantic meaning preserved?

---

## Real Example

**ContextScout Optimization**:
- **Before**: 750 lines, critical rules at line 596
- **After**: 394 lines (47.5% reduction), critical rules at line 50
- **Result**: Test passed (was failing with 0 tool calls)

**Files**:
- Optimized: `.opencode/agent/subagents/core/contextscout.md`
- Backup: (example: `.opencode/agent/ContextScout-original-backup.md`)

---

## Related

- `concepts/subagent-testing-modes.md` - How to test optimized prompts
- `guides/testing-subagents.md` - Verify tool usage works
- `errors/tool-permission-errors.md` - Fix tool issues

**Reference**: `.opencode/command/prompt-engineering/prompt-optimizer.md` (optimization principles)
