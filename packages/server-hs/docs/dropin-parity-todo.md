# Drop-In Parity TODO (Updated)

## Remaining (Highest Priority First)

- Implement `/session/{sessionID}/prompt_async` queue + worker + progress events (currently stored only).
- Match message part patch/delete side effects with TS (events, structure, metadata consistency).
- Expand `/provider/auth` to reflect env token + oauth states beyond stored tokens.
- Extend config schema for `skills` and `formatter`, and align `/global/config` + `/config` responses.
- Improve formatter detection (project/config-aware enablement) instead of executable-only.
- Add skill discovery via config paths and URL downloads (Discovery parity).

## Completed

- `/session/{sessionID}/diff` + `/summarize` with git numstat summary.
- `/session/{sessionID}/todo` storage + extraction.
- `/session/{sessionID}/command` and `/shell` implemented (Tool.Exec + PTY).
- `/session/status` returns structured status.
- Provider OAuth authorize/callback flow with state storage.
- `/permission` + `/question` stores and reply/reject state.
- `/find` + `/find/file` + `/find/symbol` using rg/fd.
- `/file/status` via git status.
- `/project` + `/project/{id}` discovery and lookup.
- TUI routes wired to store.
- Experimental tool/worktree endpoints implemented.
- `/skill` listing + `/formatter` status endpoints.
