# Standardize Chronological Ordering for Session Message Ingestion and Timelines: Session History Compaction Routines Revert Boundary

These rules are ALWAYS ACTIVE for all files matching the configured scope.

### Rules

- **R-CHRON-001** MUST: Session history compaction routines and revert boundary calculations MUST determine message sequence and cutoffs strictly by persistent creation timestamps.

### Verify

```bash
# Discover and run the project's test suite for session synchronization, timeline aggregation, and revert calculation
# Discover and run the repository linter and type-checker across packages/app, packages/tui, packages/opencode, and packages/web.
```

**Accept when:**
- Sync reducers and timeline views sort messages strictly by creation timestamp even when supplied out-of-order test events.
- Transcript exports and revert boundary calculations produce deterministic outputs matching creation timestamp ordering across all packages.

<enforcement>
Claude Code MUST NOT skip or defer verification.
</enforcement>