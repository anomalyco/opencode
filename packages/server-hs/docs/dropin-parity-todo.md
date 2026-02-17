# Drop-In Parity TODO (Updated)

## Remaining (Highest Priority First)

- No known parity gaps tracked.

## Completed

- `/session/{sessionID}/diff` + `/summarize` with git numstat summary.
- `/session/{sessionID}/todo` storage + extraction.
- `/session/{sessionID}/command` and `/shell` implemented (Tool.Exec + PTY).
- `/session/status` returns structured status.
- `/session/{sessionID}/prompt_async` queue + worker + progress events.
- Provider OAuth authorize/callback flow with state storage.
- `/permission` + `/question` stores and reply/reject state.
- `/find` + `/find/file` + `/find/symbol` using rg/fd.
- `/file/status` via git status.
- `/project` + `/project/{id}` discovery and lookup.
- TUI routes wired to store.
- Experimental tool/worktree endpoints implemented.
- `/skill` listing + `/formatter` status endpoints.
- Config schema includes `skills` + `formatter`, with `/global/config` + `/config` parity.
- Formatter detection now respects config, and skills discovery uses config paths/URLs.
