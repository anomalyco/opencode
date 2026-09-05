## ADDED Requirements

### Requirement: implementation does not proceed ahead of spike findings

This change SHALL NOT gain real implementation tasks until
`openspec/changes/claude-peer-protocol-spike/findings.md` exists and states a recommendation.

#### Scenario: the change stays gated with no findings
- **WHEN** `claude-peer-protocol-spike/findings.md` does not yet exist
- **THEN** `tasks.md` for this change contains only the unblock/gating task, no implementation tasks

#### Scenario: a "no-go" finding does not silently become a bridge protocol
- **WHEN** the spike's recommendation is no-go
- **THEN** this change is closed or re-scoped based on the documented failure reason, not replaced with an undocumented bespoke bridge protocol
