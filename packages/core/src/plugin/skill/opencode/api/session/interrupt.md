# session/interrupt

## POST /api/session/{sessionID}/interrupt

Stop the session's agent if it is running in this server process; interrupted=false means nothing was running. With resume=true it continues with pending steer items, compaction and moves, while queued messages keep waiting.

Parameters:
- `resume?: "true" | "false"` Set to true to resume pending steering input and next-in-line control items after interrupting.

Returns: `SessionInterruptResponse`

## Types

- `SessionInterruptResponse`: `{ interrupted: boolean }`
