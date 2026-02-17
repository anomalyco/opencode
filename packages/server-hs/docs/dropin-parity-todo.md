# Drop-In Parity TODO (Prioritized)

## P0 — Core session/message behavior
- Implement real `/session/{sessionID}/diff` (compute file diff + summary from worktree/session state)
- Implement real `/session/{sessionID}/summarize` (derive summary from diff)
- Implement `/session/{sessionID}/todo` (derive/update from message parts or storage)
- Implement `/session/{sessionID}/command` + `/shell` (execute with sandbox and log outputs)
- Implement `/session/{sessionID}/prompt_async` (queue + worker + progress events)
- Implement message part patch/delete side effects consistent with TS (events, structure, metadata)
- Make `/session/status` return actual running state + active tasks

## P1 — Provider / auth / permissions / questions
- Real OAuth flow for providers (authorize/callback)
- Expand `/provider/auth` to reflect env/token and oauth states
- Implement `/permission` + `/question` stores and reply/reject state changes

## P2 — File + find
- Implement `/find` + `/find/file` + `/find/symbol` with actual search (regex/glob/LSIF/etc)
- Implement `/file/status` with git status integration

## P3 — Project and config
- Real `/project` + `/project/{id}` backed by config/worktrees
- `/global/config` and `/config` parity with TS schema

## P4 — TUI + experimental
- Wire TUI routes to actual TUI control layer
- Implement experimental tool/worktree endpoints (real tooling, stateful)
