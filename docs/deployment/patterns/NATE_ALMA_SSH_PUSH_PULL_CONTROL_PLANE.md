# Pattern: Nate-Alma SSH Push/Pull Control Plane

## Trigger

Any request to manage Nate's OpenClaw Railway deployment without redeploy.

## Mandatory Sequence

1. Run SSH probe (`openclaw --version`).
2. Pull snapshot into `OP3NF1XER/nate-alma/srv/pulls`.
3. Apply remote mutations via SSH config tool or push bundle helper.
4. Verify setup health (`/setup/api/status`) and OpenClaw status (`openclaw status`).
5. Record decision + deployment journal + knowledge write-back.
6. Persist continuity checkpoint in `OP3NF1XER/nate-alma/srv/state/continuity.json`.
7. Update workflow docs/patterns when a new failure mode is discovered.

## Transport Rules

- Use pinned IDs from `OP3NF1XER/nate-alma/dev/config/railway-target.json`.
- For binary push, use chunked base64 upload over SSH (no interactive scp requirement).
- For pull, use base64 marker framing to avoid TTY binary corruption.

## Logging Rules

- Emit verbose failure-point logs with `TraceId` per run.
- Log high-risk phases with explicit `RISK` markers:
  - remote tar extract/apply,
  - config set/set-json,
  - base64 decode/marker parsing.
- Store logs under `OP3NF1XER/nate-alma/srv/logs` for session handoff continuity.

## Closure Rule

Do not close while SSH probe fails, pull artifact is missing, or push/apply path is unvalidated.
