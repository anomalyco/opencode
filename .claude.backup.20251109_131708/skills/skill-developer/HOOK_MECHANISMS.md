# Hook Mechanisms - Deep Dive

Technical deep dive into how the UserPromptSubmit and PreToolUse hooks work.

## Table of Contents

- [UserPromptSubmit Hook Flow](#userpromptsubmit-hook-flow)
- [PreToolUse Hook Flow](#pretooluse-hook-flow)
- [Exit Code Behavior (CRITICAL)](#exit-code-behavior-critical)
- [Session State Management](#session-state-management)
- [Performance Considerations](#performance-considerations)

---

## UserPromptSubmit Hook Flow

### Execution Sequence

```
User submits prompt
    ↓
.claude/settings.json registers hook
    ↓
skill-activation-prompt.sh executes
    ↓
npx tsx skill-activation-prompt.ts
    ↓
Hook reads stdin (JSON with prompt)
    ↓
Loads skill-rules.json
    ↓
Matches keywords + intent patterns
    ↓
Groups matches by priority (critical → high → medium → low)
    ↓
Outputs formatted message to stdout
    ↓
stdout becomes context for Claude (injected before prompt)
    ↓
Claude sees: [skill suggestion] + user's prompt
```

### Key Points

- **Exit code**: Always 0 (allow)
- **stdout**: → Claude's context (injected as system message)
- **Timing**: Runs BEFORE Claude processes prompt
- **Behavior**: Non-blocking, advisory only
- **Purpose**: Make Claude aware of relevant skills

### Input Format

```json
{
  "session_id": "abc-123",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/root/git/your-project",
  "permission_mode": "normal",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "how does the layout system work?"
}
```

### Output Format (to stdout)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 SKILL ACTIVATION CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 RECOMMENDED SKILLS:
  → project-catalog-developer

ACTION: Use Skill tool BEFORE responding
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Claude sees this output as additional context before processing the user's prompt.

---

## PreToolUse Hook Flow

### Execution Sequence

```
Claude calls Edit/Write tool
    ↓
.claude/settings.json registers hook (matcher: Edit|Write)
    ↓
skill-verification-guard.sh executes
    ↓
npx tsx skill-verification-guard.ts
    ↓
Hook reads stdin (JSON with tool_name, tool_input)
    ↓
Loads skill-rules.json
    ↓
Checks file path patterns (glob matching)
    ↓
Reads file for content patterns (if file exists)
    ↓
Checks session state (was skill already used?)
    ↓
Checks skip conditions (file markers, env vars)
    ↓
IF MATCHED AND NOT SKIPPED:
  Update session state (mark skill as enforced)
  Output block message to stderr
  Exit with code 2 (BLOCK)
ELSE:
  Exit with code 0 (ALLOW)
    ↓
IF BLOCKED:
  stderr → Claude sees message
  Edit/Write tool does NOT execute
  Claude must use skill and retry
IF ALLOWED:
  Tool executes normally
```

### Key Points

- **Exit code 2**: BLOCK (stderr → Claude)
- **Exit code 0**: ALLOW
- **Timing**: Runs BEFORE tool execution
- **Session tracking**: Prevents repeated blocks in same session
- **Fail open**: On errors, allows operation (don't break workflow)
- **Purpose**: Enforce critical guardrails

### Input Format

```json
{
  "session_id": "abc-123",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/root/git/your-project",
  "permission_mode": "normal",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/root/git/your-project/form/src/services/user.ts",
    "old_string": "...",
    "new_string": "..."
  }
}
```

### Output Format (to stderr when blocked)

```
⚠️ BLOCKED - Database Operation Detected

📋 REQUIRED ACTION:
1. Use Skill tool: 'database-verification'
2. Verify ALL table and column names against schema
3. Check database structure with DESCRIBE commands
4. Then retry this edit

Reason: Prevent column name errors in Prisma queries
File: form/src/services/user.ts

💡 TIP: Add '// @skip-validation' comment to skip future checks
```

Claude receives this message and understands it needs to use the skill before retrying the edit.

---

## Exit Code Behavior (CRITICAL)

### Exit Code Reference Table

| Exit Code | stdout | stderr | Tool Execution | Claude Sees |
|-----------|--------|--------|----------------|-------------|
| 0 (UserPromptSubmit) | → Context | → User only | N/A | stdout content |
| 0 (PreToolUse) | → User only | → User only | **Proceeds** | Nothing |
| 2 (PreToolUse) | → User only | → **CLAUDE** | **BLOCKED** | stderr content |
| Other | → User only | → User only | Blocked | Nothing |

### Why Exit Code 2 Matters

This is THE critical mechanism for enforcement:

1. **Only way** to send message to Claude from PreToolUse
2. stderr content is "fed back to Claude automatically"
3. Claude sees the block message and understands what to do
4. Tool execution is prevented
5. Critical for enforcement of guardrails

### Example Conversation Flow

```
User: "Add a new user service with Prisma"

Claude: "I'll create the user service..."
    [Attempts to Edit form/src/services/user.ts]

PreToolUse Hook: [Exit code 2]
    stderr: "⚠️ BLOCKED - Use database-verification"

Claude sees error, responds:
    "I need to verify the database schema first."
    [Uses Skill tool: database-verification]
    [Verifies column names]
    [Retries Edit - now allowed (session tracking)]
```

---

## Session State Management

### Purpose

Prevent repeated nagging in the same session - once Claude uses a skill, don't block again.

### State File Location

`.claude/hooks/state/skills-used-{session_id}.json`

### State File Structure

```json
{
  "skills_used": [
    "database-verification",
    "error-tracking"
  ],
  "files_verified": []
}
```

### How It Works

1. **First edit** of file with Prisma:
   - Hook blocks with exit code 2
   - Updates session state: adds "database-verification" to skills_used
   - Claude sees message, uses skill

2. **Second edit** (same session):
   - Hook checks session state
   - Finds "database-verification" in skills_used
   - Exits with code 0 (allow)
   - No message to Claude

3. **Different session**:
   - New session ID = new state file
   - Hook blocks again

### Limitation

The hook cannot detect when the skill is *actually* invoked - it just blocks once per session per skill. This means:

- If Claude doesn't use the skill but makes a different edit, it won't block again
- Trust that Claude follows the instruction
- Future enhancement: detect actual Skill tool usage

---

## Performance Considerations

### Target Metrics

- **UserPromptSubmit**: < 100ms
- **PreToolUse**: < 200ms

### Performance Bottlenecks

1. **Loading skill-rules.json** (every execution)
   - Future: Cache in memory
   - Future: Watch for changes, reload only when needed

2. **Reading file content** (PreToolUse)
   - Only when contentPatterns configured
   - Only if file exists
   - Can be slow for large files

3. **Glob matching** (PreToolUse)
   - Regex compilation for each pattern
   - Future: Compile once, cache

4. **Regex matching** (Both hooks)
   - Intent patterns (UserPromptSubmit)
   - Content patterns (PreToolUse)
   - Future: Lazy compile, cache compiled regexes

### Optimization Strategies

**Reduce patterns:**
- Use more specific patterns (fewer to check)
- Combine similar patterns where possible

**File path patterns:**
- More specific = fewer files to check
- Example: `form/src/services/**` better than `form/**`

**Content patterns:**
- Only add when truly necessary
- Simpler regex = faster matching

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill guide
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Debug hook issues
- [SKILL_RULES_REFERENCE.md](SKILL_RULES_REFERENCE.md) - Configuration reference
