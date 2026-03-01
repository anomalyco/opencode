# Pattern: MongoDB-Present Investigation Path

## Trigger

Runtime explicitly shows MongoDB connectivity (startup connection logs, successful DB reads) while processing remains blocked.

## Mandatory Sequence

1. Confirm MongoDB is reachable from runtime logs.
2. Pivot immediately to data-state investigation (not infrastructure fault framing).
3. Capture credential-state snapshot (`total`, `enabled`, `banned`, `enabled && !banned`).
4. If canonical DB has zero actionable records but legacy DB has data, run migration into canonical DB.
5. Publish operator-facing guidance describing exact collection/flags to inspect.
6. Record findings and remediation path in Decision and `OP3NF1XER/knowledge`.

## Closure Rule

Do not close while messaging still implies generic runtime failure when the root blocker is data-state eligibility.
Do not close with auto-pivot-only remediation when migration is required by historical Decisions.
