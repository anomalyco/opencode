---
name: jules-monitor
description: Set up and run a Jules session status monitor. USE WHEN starting an opencode agent session, whenever an agent session begins, when Jules sessions are running in the background, when you need to check on in-flight Jules implementation agents, when spawning a Jules session to track, or when asked to monitor Jules status.
license: MIT
compatibility: opencode
metadata:
  topic: jules-monitoring
---

# Jules Session Monitor

## When to use

Every time an opencode agent session starts, always start a Jules agent cron job to monitor the status of in-flight Jules sessions. Do this at session start before doing any other work.

## Tracking model

The monitor tracks session IDs dynamically from `~/.jules/tracked_sessions` ("id workspace" per line) — it does not hardcode a list. Whenever a new Jules session is spawned for background work, register its session ID so the cron job keeps monitoring it for the current workspace:

```bash
~/.config/opencode/scripts/jules_monitor.sh add <session-id> "$PWD"
```

## Procedure

### 1. Verify monitor script

The monitor script lives at `~/.config/opencode/scripts/jules_monitor.sh`. Ensure it is executable:

```bash
chmod +x ~/.config/opencode/scripts/jules_monitor.sh
```

### 2. Install the workspace-scoped cron job

Ensure the workspace-scoped cron job is installed (runs every 5 minutes, idempotent per workspace):

```bash
~/.config/opencode/scripts/jules_monitor.sh install
```

### 3. Register in-flight sessions

Check what the monitor is tracking for this workspace and register in-flight sessions:

```bash
~/.config/opencode/scripts/jules_monitor.sh list "$PWD"
# Add any session that should be watched for the current workspace:
~/.config/opencode/scripts/jules_monitor.sh add <session-id> "$PWD"
# Stop tracking a finished/abandoned session:
~/.config/opencode/scripts/jules_monitor.sh remove <session-id>
```

`list` shows each tracked session with its repo and normalized status (e.g. `AWAITING_USER_FEEDBACK`, `IN_PROGRESS`, `COMPLETED`).

### 4. Verify the script runs

Run it once to confirm it works:

```bash
bash /home/team/.config/opencode/scripts/jules_monitor.sh
```

### 5. Monitor status with a sub agent

Spawn a sub agent (use the `general` subagent type via the task tool) to watch the monitor output. Instruct the sub agent to:

- Read `~/.jules/monitor_state` and `~/.jules/jules_monitor.log`
- Report any session that has been `AWAITING_USER_FEEDBACK` or `FAILED` for 15+ minutes (the log marks these as `STUCK>=15m`)
- Report any `COMPLETED` sessions (check the PR link)
- Report state transitions logged since the last check
- Surfaced sessions stuck awaiting feedback or failed need a nudge or force-resolve

## Notes

- The monitor is safe for cron: it pipes `/dev/null` to the CLI and parses the table structurally (splits on 2+ spaces), so emoji in descriptions do not break status/repo extraction.
- The log is bounded to the last 400 lines.
- Log entries include the session's repo (e.g. `TRANSITION  12345 (owner/repo): IN_PROGRESS -> COMPLETED`).
- State entries for sessions no longer tracked are pruned automatically on each run.