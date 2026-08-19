# Plan: Crash Recovery — Auto-Restart + Session Resume

## Problem

When opencode crashes (SIGKILL, panic, OOM, power loss), all in-memory session
status is lost. Sessions that were "busy" at crash time are left in an
indeterminate state. There is no mechanism to detect the crash on next startup
and resume the previously active sessions.

## Design

### 1. Active Sessions Manifest (`packages/opencode/src/session/active-manifest.ts`)

A JSON file stored at `Global.Path.data/active-sessions.json` that tracks which
sessions are currently busy.

**Schema:**
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "model": { "id": "model-id", "providerID": "provider-id", "variant": "variant-name" },
      "agent": "build",
      "timestamp": 1234567890
    }
  ]
}
```

**API (pure functions using Bun.file):**
- `writeActiveSession(entry)` — add/update a session in the manifest
- `removeActiveSession(sessionID)` — remove a session from the manifest
- `readActiveSessions()` — read the manifest (returns session list)
- `clearActiveSessions()` — delete the manifest file (clean shutdown sentinel)
- `hasCrashed()` — returns true if manifest file exists (crash detected)

### 2. Config Option (`packages/core/src/v1/config/config.ts`)

Add `session` field:
```ts
session: Schema.optional(Schema.Struct({
  auto_resume: Schema.optional(Schema.Boolean).annotate({
    description: "Automatically resume sessions that were active when opencode crashed (default: false)"
  })
}))
```

### 3. SessionStatus Hook (`packages/opencode/src/session/status.ts`)

When `set` is called:
- `type: "busy"` → write session to manifest
- `type: "idle"` → remove session from manifest

### 4. Crash Detection on Startup (`packages/opencode/src/cli/cmd/run/runtime.ts`)

Before session resolution:
- If `hasCrashed()` AND `config.session?.auto_resume` → read manifest, resume sessions
- If no crash or auto_resume disabled → proceed normally
- After resuming, clear the manifest

### 5. Graceful Shutdown (`packages/opencode/src/index.ts`)

On SIGINT/SIGTERM and in the `finally` block before `process.exit()`:
- Call `clearActiveSessions()` to mark a clean shutdown

## Acceptance Criteria

1. Given a session is busy, when opencode crashes, then the manifest persists with the session ID
2. Given opencode starts and manifest exists AND auto_resume is on, then sessions are resumed
3. Given opencode starts and manifest is absent, then no auto-resume
4. Given opencode exits gracefully, then manifest is deleted (clean sentinel)
5. Given auto_resume is false/unset, then no auto-resume even after crash
6. Given a session in manifest no longer exists in DB, then it is skipped

## Test Strategy

- Unit tests for manifest read/write/clear operations (temp dirs)
- Test that busy→manifest write happens
- Test that idle→manifest remove happens
- Test crash detection (manifest exists = crash)
- Test clean shutdown clears manifest
