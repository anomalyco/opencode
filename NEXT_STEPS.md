# Shipping Next Steps

## Current Status

The multi-account foundation is in place:
- Multiple provider accounts can be connected and switched.
- Model selection now stores `accountKey` in session-local state and recent picks.
- Prompt submit and session compact now enforce the selected account is active.

## Immediate Next Step (P0)

Persist `accountKey` in backend session/user message model metadata so account selection survives full session history restore.

### Implementation Outline

1. Extend backend message/session model payloads to carry optional `accountKey`.
2. Thread `accountKey` through session prompt/command APIs and persistence layer.
3. Regenerate SDK types/clients and update app calls.
4. Restore local session model from backend `accountKey` when replaying session history.
5. Add migration-safe behavior for older messages with no `accountKey`.

## Follow-Up Steps (P1)

1. Add tests for account-aware restore and compact flows.
2. Clean up generated SDK method naming (`accounts2.activate`) if route generation allows.
3. Add a subtle UI indicator in prompt header when a non-default account is selected.

## Ship Exit Criteria For This Track

1. Switching accounts changes provider auth for prompts and compact reliably.
2. Reloading app + reopening session preserves account-specific model selection.
3. `release:gate` and deferred suites in `TESTS.md` pass before final ship.
