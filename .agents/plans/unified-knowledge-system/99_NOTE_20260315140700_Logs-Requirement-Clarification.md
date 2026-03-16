# Logs Requirement Clarification

**Requirement:** Logs are REQUIRED whenever the agent performs significant work (tool execution, code changes, file modifications).

---

## What Triggers a Log Write

A log is written on session idle IF the session contains significant work:

### Significant Work Indicators

- **File Changes:** Any files added, modified, or deleted
- **Tool Executions:** Agent executed tools (bash, write, edit, etc.)
- **Code Modifications:** Lines added, deleted, or changed
- **Session Activity:** Messages/steps showing agent activity

### Detection Logic

```typescript
hasWork = (filesAdded > 0) OR
          (linesAdded > 0) OR
          (linesDeleted > 0) OR
          (toolExecutions > 0) OR
          (messageCount > 0)
```

If `hasWork` is true, a log MUST be written on idle.

---

## Log Content Structure

### What (What was built)

- Session title or inferred from context
- Example: "Add knowledge system to OpenCode", "Fix network retry logic"

### How (How it was built)

- Inferred from session methodology:
  - "Manual implementation" — No tool executions
  - "Implementation with agent assistance" — Some tool executions
  - "Iterative implementation with multiple tool executions" — Many iterations
  - "Automated session" — Fully automated

### Where (Where it was built)

- Primary directory/path from file changes
- Example: "src/knowledge/", "packages/opencode/src/"
- Falls back to "Session workspace" if unclear

### Changes Metrics

- `filesAdded` — Count of files added
- `linesAdded` — Count of lines added
- `linesDeleted` — Count of lines deleted
- `testsAdded` — Count of tests (future: parse from diffs)

### Tags (Auto-generated)

- Always: `["auto-log", "session-end"]`
- By scope:
  - `large-change` if filesAdded > 10
  - `feature` if filesAdded > 0
  - `significant-work` if linesAdded > 500
- By type (inferred from session title):
  - `testing` if title contains "test"
  - `bugfix` if title contains "fix" or "bug"
  - `refactor` if title contains "refactor"
  - `documentation` if title contains "doc"

---

## Writeback Thresholds

Based on session step count (message/tool execution count):

| Step Count | Writebacks                     | Conditions                                                      |
| ---------- | ------------------------------ | --------------------------------------------------------------- |
| <20        | 1 log                          | Only if significant work detected                               |
| 20-40      | 2 (log + pattern)              | Log required if work done; pattern if error recovery detected   |
| ≥40        | 3+ (log + pattern + knowledge) | Log required; pattern if applicable; knowledge if architectural |

---

## Session Idle Trigger

A session becomes idle when:

- Agent stops responding (no new messages)
- Session is archived/completed
- User explicitly marks session as done

On idle, the system:

1. Checks `hasWork()` to detect if significant work was done
2. If `hasWork` is true, ALWAYS writes a log
3. If step count ≥ 20, extracts patterns if applicable
4. If step count ≥ 40, extracts knowledge if applicable

---

## Examples

### Example 1: Small Session (<20 steps)

```
Session Title: "Add read tool parameter validation"
Files Changed: 2
Lines Added: 45
Tool Executions: 3

Idle Trigger:
- hasWork = true (2 files, 45 lines, 3 tools)
- stepCount = 8 (<20)
- Writebacks: 1 log entry

Log Written:
- What: "Add read tool parameter validation"
- How: "Implementation with agent assistance"
- Where: "src/tool/"
- Tags: ["auto-log", "session-end", "feature"]
```

### Example 2: Medium Session (20-40 steps)

```
Session Title: "Fix network timeout retry logic"
Files Changed: 3
Lines Added: 120
Tool Executions: 8
Error Recovery: Yes (error then success)

Idle Trigger:
- hasWork = true
- stepCount = 28 (20-40 range)
- Writebacks: 2 entries (log + pattern)

Log Written:
- What: "Fix network timeout retry logic"
- How: "Iterative implementation with multiple tool executions"
- Where: "src/network/"
- Tags: ["auto-log", "session-end", "feature", "bugfix"]

Pattern Written (if detected):
- Title: "Recovery Pattern: Network Timeout Resolution"
- Tags: ["recovery", "network", "auto-detected"]
```

### Example 3: Long Session (≥40 steps)

```
Session Title: "Refactor session architecture"
Files Changed: 12
Lines Added: 800
Tool Executions: 15
Architectural Changes: Yes

Idle Trigger:
- hasWork = true
- stepCount = 45 (≥40 range)
- Writebacks: 3+ entries (log + pattern + knowledge)

Log Written:
- What: "Refactor session architecture"
- How: "Iterative implementation with multiple tool executions"
- Where: "src/session/"
- Tags: ["auto-log", "session-end", "large-change", "refactor", "significant-work"]

Pattern Written (if error recovery detected)

Knowledge Written (if architectural decision detected):
- Category: "architecture"
- Impact: "high"
```

### Example 4: No Significant Work

```
Session Title: "Review code"
Files Changed: 0
Lines Added: 0
Tool Executions: 0

Idle Trigger:
- hasWork = false
- stepCount = 5
- Writebacks: NONE

No logs written (no work was done)
```

---

## Implementation Details

### hasWork() Function

Located in `Session.onIdle()`:

```typescript
async function hasWork(sessionID: SessionID): Promise<boolean> {
  const session = await Session.get(sessionID)

  const hasFileChanges =
    (session.summary?.files ?? 0) > 0 || (session.summary?.additions ?? 0) > 0 || (session.summary?.deletions ?? 0) > 0

  const hasToolExecutions = (session.messages?.length ?? 0) > 0

  return hasFileChanges || hasToolExecutions
}
```

### LogExtractor.extract() Function

Analyzes session and creates log entry:

- Extracts metrics from `session.summary`
- Infers "how" from message/tool count
- Infers "where" from common file directory
- Generates tags based on scope and type

---

## Key Points

✅ **Mandatory:** Every session with significant work MUST write a log on idle  
✅ **Automatic:** No explicit agent action required  
✅ **Intelligent:** Infers what/how/where from session history  
✅ **Tagged:** Auto-generates semantic tags for discovery  
✅ **Graceful:** If extraction fails, logs error and continues  
✅ **Threshold-based:** Additional patterns/knowledge based on flight length

---

## Testing

### Test Cases

1. **Small session with work** — Verify 1 log written
2. **Medium session with work** — Verify log + pattern written
3. **Long session with work** — Verify log + pattern + knowledge written
4. **Session with no work** — Verify no logs written
5. **Session with error recovery** — Verify pattern extracted
6. **Session with large changes** — Verify "large-change" tag applied
7. **Extraction failure** — Verify error logged, system continues

### Manual Verification

```bash
# Create test session with significant work
# Add files, execute tools, make changes
# Let session idle
# Verify in knowledge database:
sqlite3 ~/.opencode/data/opencode.db "
  SELECT type, title, tags FROM knowledge_entry
  WHERE type='log' AND agent='session-auto'
  ORDER BY time_created DESC LIMIT 5;
"
```

Expected: Log entries present with correct tags and descriptions.
