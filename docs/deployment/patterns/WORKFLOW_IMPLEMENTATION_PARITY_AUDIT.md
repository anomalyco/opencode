# Pattern: Workflow Implementation Parity Audit

## Trigger

Any pass where implementation direction could conflict with prior Decisions.

## Mandatory Sequence

1. Compare chosen remediation with applicable historical Decision guidance.
2. Mark parity status per requirement (`PASS`, `PARTIAL`, `FAIL`).
3. If any `PARTIAL`/`FAIL`, self-fix in the same pass.
4. Re-run verification and publish a re-audit matrix.
5. Capture reusable workflow correction in `OP3NF1XER/patterns`.

## Closure Rule

Do not close when remediation bypasses historical migration guidance without explicit override from Nexus/Pyxis.
