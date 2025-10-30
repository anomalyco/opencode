---
name: continue
description: Resume execution from the last completed step
version: 1.0.0
last_updated: 2025-10-04
command_schema_version: 1.0
inputs:
  - name: session_id
    type: string
    required: false
    description: Specific session ID to continue (optional)
cache_strategy:
  type: agent_specific
  ttl: 1800
  invalidation: time_based
  scope: command
success_signals:
  - 'Session successfully resumed'
  - 'Last completed step identified'
  - 'Execution continued from correct point'
failure_modes:
  - 'No previous session found'
  - 'Session state corrupted or incomplete'
  - 'Environment state incompatible'
---

# Continue From Last Step

Resume the previous task from where it left off. This prompt analyzes conversation history to identify the last completed step and continues with the next pending action without repeating prior work.

## Purpose

Provide seamless task continuation across sessions by maintaining context and state from previous executions. Enables efficient workflow resumption without manual restatement of requirements or progress.

## Usage

### OpenCode

```bash
# Continue last session
opencode -c

# Continue with specific model
opencode -c -m anthropic/claude-sonnet-4-20250514

# Continue specific session
opencode -s <session-id>

# Use continue command (structured approach)
opencode -p continue
```

### Claude Code

```bash
# Continue last session
claude -c

# Continue with specific model
claude -c --model sonnet

# Resume specific session (interactive)
claude -r

# Resume specific session by ID
claude -r <session-id>

# Fork session (create new ID from existing)
claude -r <session-id> --fork-session
```

### Codeflow (via OpenCode or Claude Code)

Codeflow provides the continue command as a structured workflow command that can be used with either OpenCode or Claude Code:

```bash
# After installing via codeflow setup, use the command:
# In OpenCode:
opencode -p continue

# In Claude Code, use the built-in continue:
claude -c

# The command is available in:
# - command/continue.md (base format)
# - .opencode/command/continue.md (OpenCode format)
# - .claude/commands/continue.md (Claude Code format)
```

## Process Phases

### Phase 1: Context Recovery

1. **Locate Last Session**: Identify most recent session or specified session ID
2. **Load Conversation History**: Retrieve complete conversation context
3. **Parse Task Structure**: Extract task breakdown and execution state
4. **Identify Completion State**: Determine which steps have been completed

### Phase 2: State Analysis

1. **Validate Completeness**: Verify last completed step was fully finished
2. **Check Dependencies**: Ensure prerequisites for next step are met
3. **Assess Context**: Determine if sufficient information exists to continue
4. **Identify Next Action**: Determine the immediate next step to execute

### Phase 3: Continuation Execution

1. **Resume Work**: Begin execution from identified next step
2. **Maintain Context**: Carry forward relevant decisions and constraints
3. **Track Progress**: Update execution state as steps complete
4. **Validate Results**: Ensure continued work aligns with original objectives

## Inputs

- **session_history**: Previous conversation context and task state
- **task_breakdown**: Structured list of steps and their completion status
- **execution_context**: Environment state and configuration from last session
- **artifacts**: Any code, files, or outputs from previous work

## Preconditions

- Previous session exists and is accessible
- Task structure was clearly defined in original session
- Environment state has not changed incompatibly
- Required context is available in session history

## Success Criteria

#### Automated Verification

- [ ] Previous session successfully located and loaded
- [ ] Last completed step correctly identified
- [ ] Next step determined and execution begun
- [ ] No duplicate work performed
- [ ] Original task objectives maintained

#### Manual Verification

- [ ] Continuation feels seamless and contextually appropriate
- [ ] Work builds naturally on previous progress
- [ ] No obvious context gaps or misunderstandings
- [ ] Task progresses toward original completion goals

## Error Handling

### No Previous Session

```error-context
{
  "prompt": "continue",
  "phase": "context_recovery",
  "error_type": "no_session",
  "expected": "Existing session with task history",
  "found": "No previous session found",
  "mitigation": "Start new task instead of continuing",
  "requires_user_input": true,
  "suggested_action": "Provide complete task description"
}
```

### Insufficient Context

```error-context
{
  "prompt": "continue",
  "phase": "state_analysis",
  "error_type": "insufficient_context",
  "expected": "Clear task breakdown with completion states",
  "found": "Ambiguous or incomplete task structure",
  "mitigation": "Request clarification of current state and next steps",
  "requires_user_input": true,
  "suggested_action": "Summarize progress and confirm next action"
}
```

### Environment State Mismatch

```error-context
{
  "prompt": "continue",
  "phase": "state_analysis",
  "error_type": "environment_changed",
  "expected": "Consistent environment state",
  "found": "Files modified or environment reconfigured",
  "mitigation": "Reassess current state before continuing",
  "requires_user_input": false,
  "suggested_action": "Verify current environment state"
}
```

## Structured Output Specification

### Primary Output

```prompt-output:continuation_state
{
  "status": "resumed|analyzing|error",
  "timestamp": "ISO-8601",
  "session": {
    "id": "session-uuid",
    "started": "ISO-8601",
    "last_activity": "ISO-8601"
  },
  "analysis": {
    "total_steps": 10,
    "completed_steps": 6,
    "last_completed": "Implement user authentication",
    "next_step": "Add password reset functionality",
    "remaining_steps": 4
  },
  "context": {
    "task_objective": "Build authentication system",
    "key_constraints": ["JWT tokens", "rate limiting"],
    "artifacts_available": ["src/auth/login.ts", "tests/auth.test.ts"]
  },
  "continuation_plan": {
    "immediate_action": "Implement password reset endpoint",
    "dependencies_met": true,
    "estimated_completion": "15-20 minutes"
  },
  "metadata": {
    "context_recovery_time": 250,
    "confidence": 0.95
  }
}
```

## Edge Cases

### Partial Step Completion

- Last step may have been interrupted mid-execution
- Verify artifact completeness before proceeding
- May need to complete partial work before advancing

### Task Objective Changed

- User may want to modify original task direction
- Confirm objectives still align before continuing
- Allow for course correction if needed

### Multiple Parallel Sessions

- Ensure correct session is being resumed
- Verify session ID when multiple tasks are active
- Prevent accidentally continuing wrong task

## Anti-Patterns

### Avoid These Practices

- **Blindly repeating work**: Always verify step completion status first
- **Ignoring context gaps**: Address missing information before proceeding
- **Assuming unchanged state**: Validate environment hasn't changed
- **Skipping validation**: Verify last step truly completed successfully

## Caching Guidelines

### Cache Usage Patterns

- **Session state**: Cache recent session context for quick resumption
- **Task structure**: Store task breakdown for efficient state analysis
- **Artifact tracking**: Remember which files/outputs were created

### Cache Invalidation Triggers

- **Manual**: Session explicitly ended or cleared
- **Content-based**: Environment state changes significantly
- **Time-based**: Session inactive for > 30 minutes

## Performance Optimization

- Context recovery time: < 500ms for recent sessions
- State analysis time: < 1 second for typical task structures
- Memory usage: < 5MB for session context cache

## Integration with Other Commands

This prompt works well with:

- `/plan`: Resume execution of a planned task
- `/execute`: Continue multi-step execution workflow
- `/document`: Resume documentation generation

## Examples

### Simple Task Continuation

```bash
# Original session
opencode run "Add user authentication with JWT"
# ... work performed ...
# Session interrupted

# Resume later
opencode run --prompt continue
# Automatically picks up from last completed step
```

### Explicit Session Continuation

```bash
# Continue specific session
opencode run --prompt continue --session abc-123-def-456

# Continue with different model
opencode run --prompt continue --model openai/gpt-4o
```

### Combining with Session Flag

```bash
# OpenCode CLI shorthand
opencode run --continue

# Equivalent to
opencode run --prompt continue
```

---

## CLI Flag Reference

### Global Flags (work with any command)

- `-m, --model`: Specify model in format `provider/model`
- `-c, --continue`: Continue the last session (built-in)
- `-s, --session`: Specify session ID to continue
- `-p, --prompt`: Use a prompt file (like this one)
- `--agent`: Use a specific agent

### Shorthand Comparison

**Built-in Continue (Simple):**

```bash
opencode run -c -m anthropic/claude-sonnet-4-20250514
```

**Custom Continue Prompt (Structured):**

```bash
opencode run -p continue -m anthropic/claude-sonnet-4-20250514
```

### When to Use Which

Use **`-c`** (built-in) when:

- You want quick session resumption
- Simple task continuation is sufficient
- You trust OpenCode's default continuation logic

Use **`-p continue`** (this prompt) when:

- You need structured step-by-step analysis
- You want detailed error handling
- You need explicit state validation
- You require comprehensive context recovery

### Combined Usage

You can combine flags:

```bash
# Use custom prompt with specific session and model
opencode run -p continue -s abc-123 -m anthropic/claude-sonnet-4-20250514

# Use built-in continue with specific model
opencode run -c -m openai/gpt-4o
```
