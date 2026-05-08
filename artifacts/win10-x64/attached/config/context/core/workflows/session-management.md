<!-- Context: workflows/sessions | Priority: medium | Version: 2.0 | Updated: 2025-01-21 -->
# Session Management

## Quick Reference

**Key Principle**: Lazy initialization - only create when needed

**Session ID**: `{timestamp}-{random-4-chars}` (e.g., `20250118-143022-a4f2`)

**Cleanup**: Always ask user confirmation before deleting

**Safety**: NEVER delete outside current session, ONLY delete tracked files, ALWAYS confirm

---

## Lazy Initialization

**Only create session when first context file needed**

- Don't create sessions for simple questions or direct execution
- Initialize on first delegation that requires context file
- Session ID format: `{timestamp}-{random-4-chars}`
- Example: `20250118-143022-a4f2`

## Session Structure

```
.tmp/sessions/{session-id}/
├── .manifest.json
├── features/
│   └── {task-name}-context.md
├── documentation/
│   └── {task-name}-context.md
├── code/
│   └── {task-name}-context.md
├── tasks/
│   └── {task-name}-tasks.md
└── general/
    └── {task-name}-context.md
```

## Session Isolation

**Each session has unique ID - prevents concurrent agent conflicts**

✅ Multiple agent instances can run simultaneously
✅ No file conflicts between sessions
✅ Each session tracks only its own files
✅ Safe cleanup - only deletes own session folder

## Manifest Structure

**Location**: `.tmp/sessions/{session-id}/.manifest.json`

```json
{
  "session_id": "20250118-143022-a4f2",
  "created_at": "2025-01-18T14:30:22Z",
  "last_activity": "2025-01-18T14:35:10Z",
  "context_files": {
    "features/user-auth-context.md": {
      "created": "2025-01-18T14:30:22Z",
      "for": "@TaskManager",
      "keywords": ["user-auth", "authentication", "features"]
    },
    "tasks/user-auth-tasks.md": {
      "created": "2025-01-18T14:32:15Z",
      "for": "@TaskManager",
      "keywords": ["user-auth", "tasks", "breakdown"]
    }
  },
  "context_index": {
    "user-auth": [
      "features/user-auth-context.md",
      "tasks/user-auth-tasks.md"
    ]
  }
}
```

## Activity Tracking

**Update timestamp after each context file creation or delegation**

- Update `last_activity` field in manifest
- Used for stale session detection
- Helps identify active vs abandoned sessions

## Cleanup Policy

### Manual Cleanup (Preferred)
**Ask user confirmation before cleanup**

After task completion:
1. Ask: "Should I clean up temporary session files at `.tmp/sessions/{session-id}/`?"
2. Wait for user confirmation
3. Only delete files tracked in current session's manifest
4. Remove entire session folder: `.tmp/sessions/{session-id}/`

### Safety Rules
- **NEVER** delete files outside current session
- **ONLY** delete files tracked in manifest
- **ALWAYS** confirm with user before cleanup

### Stale Session Cleanup
**Auto-remove sessions >24 hours old**

- Check `last_activity` timestamp in manifest
- Safe to run periodically (see `scripts/cleanup-stale-sessions.sh`)
- Won't affect active sessions

## Error Handling

### Subagent Failure
- Report error to user
- Ask if should retry or abort
- Don't auto-retry without approval

### Context File Error
- Fall back to inline context in delegation prompt
- Warn user that context file creation failed
- Continue with task if possible

### Session Creation Error
- Continue without session
- Warn user
- Use inline context for delegation
- Don't block task execution

## Best Practices

1. **Lazy Init**: Only create session when actually needed
2. **Track Everything**: Add all context files to manifest
3. **Update Activity**: Touch `last_activity` on each operation
4. **Clean Promptly**: Remove files after task completion
5. **Isolate Sessions**: Never access files from other sessions
6. **Confirm Cleanup**: Always ask user before deleting

## Example Workflow

```bash
# User: "Build user authentication system"
# → Complex task, needs context file
# → Create session: 20250118-143022-a4f2
# → Create: .tmp/sessions/20250118-143022-a4f2/features/user-auth-context.md
# → Delegate to @task-manager

# User: "Implement login component"
# → Same session, add context
# → Create: .tmp/sessions/20250118-143022-a4f2/code/login-context.md
# → Delegate to @coder-agent

# Task complete
# → Ask: "Clean up session files?"
# → User confirms
# → Delete: .tmp/sessions/20250118-143022-a4f2/
```
