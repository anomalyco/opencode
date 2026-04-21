# Shipping Next Steps

## Current Status

The multi-account foundation is in place and account identity now survives session persistence:
- Multiple provider accounts can be connected and switched.
- Model selection now stores `accountKey` in session-local state and recent picks.
- Prompt submit and session compact now enforce the selected account is active.
- Backend user/subtask message metadata now stores optional `accountKey`.
- Session init/command flows now accept and thread `accountKey`.
- Replayed session history now restores model selection with `accountKey` when present.

## Completed (P0)

Persist `accountKey` across backend session/user metadata and API flows so account selection survives full session history restore.

## Immediate Next Steps (P1)

1. Expand tests for account-aware restore and compact on a full session replay path.
2. Clean up generated SDK method naming (`accounts2.activate`) if route generation allows.
3. Add a subtle prompt-header indicator when a non-default provider account is selected.

## Migration Safety Note

Older messages without `accountKey` remain valid and continue to load (field is optional).

## Ship Exit Criteria For This Track

1. Switching accounts changes provider auth for prompts and compact reliably.
2. Reloading app + reopening session preserves account-specific model selection.
3. `release:gate` and deferred suites in `TESTS.md` pass before final ship.
